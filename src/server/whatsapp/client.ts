import "server-only";
import { z } from "zod";
import { getIntegration } from "../integrations";
import { waId } from "./phone";

/*
 * Thin WhatsApp Cloud API (Graph) client over fetch: template + session-text messages, timeouts, retries on
 * 429/5xx/network, zod-parsed responses. Credentials come only from Admin → Integrations (never env).
 */

export type Outgoing =
  | { type: "template"; name: string; language: string; bodyVars: string[]; buttonPayloads?: string[] }
  | { type: "text"; body: string };

export type SendResult = { ok: true; id: string; mock: boolean } | { ok: false; error: string; mock: boolean };

const sendResponse = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
const errorResponse = z.object({ error: z.object({ message: z.string(), code: z.number().optional(), error_data: z.object({ details: z.string() }).partial().optional() }) });

export type WhatsAppMode = "live" | "mock";

/** Live only when switched on with a phone number id and token, and never during test runs. */
export async function whatsappMode(): Promise<WhatsAppMode> {
  if (process.env.WHATSAPP_TRANSPORT === "log") return "mock";
  const c = await getIntegration("whatsapp");
  return c.enabled && c.phoneNumberId && c.accessToken ? "live" : "mock";
}

/** Graph API body for one message. */
export function buildPayload(toE164: string, m: Outgoing) {
  if (m.type === "text") {
    return { messaging_product: "whatsapp", recipient_type: "individual", to: waId(toE164), type: "text", text: { preview_url: true, body: m.body.slice(0, 4096) } };
  }
  const components: Record<string, unknown>[] = [];
  if (m.bodyVars.length) {
    // Template variables can't contain newlines/tabs or 4+ spaces; keep them short.
    components.push({ type: "body", parameters: m.bodyVars.map((v) => ({ type: "text", text: v.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000) || "-" })) });
  }
  (m.buttonPayloads ?? []).forEach((payload, index) => {
    components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
  });
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waId(toE164),
    type: "template",
    template: { name: m.name, language: { code: m.language }, ...(components.length ? { components } : {}) },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends one message. Mock mode returns a fake id without any network call. */
export async function sendRaw(toE164: string, m: Outgoing, opts: { attempts?: number; timeoutMs?: number } = {}): Promise<SendResult> {
  const mode = await whatsappMode();
  if (mode === "mock") return { ok: true, id: `test.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`, mock: true };

  const c = await getIntegration("whatsapp");
  const url = `https://graph.facebook.com/${c.apiVersion}/${encodeURIComponent(c.phoneNumberId)}/messages`;
  const body = JSON.stringify(buildPayload(toE164, m));
  const attempts = opts.attempts ?? 3;
  let lastError = "Unknown error";
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(400 * 2 ** (i - 1));
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        cache: "no-store",
      });
    } catch (e) {
      lastError = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out" : e.message) : "Network error";
      continue;
    }
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = sendResponse.safeParse(json);
      if (parsed.success) return { ok: true, id: parsed.data.messages[0].id, mock: false };
      return { ok: false, error: "Unexpected response from WhatsApp", mock: false };
    }
    const err = errorResponse.safeParse(json);
    lastError = err.success ? `${err.data.error.message}${err.data.error.code ? ` (#${err.data.error.code})` : ""}${err.data.error.error_data?.details ? ` — ${err.data.error.error_data.details}` : ""}` : `HTTP ${res.status}`;
    // Only rate limits and server errors are worth retrying; 4xx (bad template, bad number) won't change.
    if (res.status !== 429 && res.status < 500) break;
  }
  return { ok: false, error: lastError.slice(0, 500), mock: false };
}
