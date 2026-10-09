import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { env } from "@/env";

/**
 * Third-party credentials, editable from Admin → Integrations and stored in the `Setting` table
 * (key `integration:<provider>`), encrypted with AES-256-GCM. A value saved here wins over the matching
 * environment variable; env stays the fallback so existing deployments keep working unchanged.
 *
 * Secrets never leave the server: the admin UI only ever receives `maskedIntegration()`.
 */

// ─────────────────────────────── Provider catalogue ───────────────────────────────

export type FieldSpec = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  type?: "text" | "number" | "select" | "boolean";
  options?: { value: string; label: string }[];
};

const str = z.string().trim().default("");
const bool = z.boolean().default(false);

export const PROVIDERS = {
  email: {
    title: "Email",
    blurb: "Sign-in links, receipts and journeys. Gmail SMTP (with an app password) can send to anyone; Resend needs a verified domain.",
    schema: z.object({
      mode: z.enum(["auto", "smtp", "resend"]).default("auto"),
      smtpHost: z.string().trim().default("smtp.gmail.com"),
      smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
      smtpUser: str,
      smtpPassword: str,
      resendApiKey: str,
      from: str,
    }),
    fields: [
      { key: "mode", label: "Send with", type: "select", options: [{ value: "auto", label: "Auto (SMTP if set, else Resend)" }, { value: "smtp", label: "SMTP (Gmail)" }, { value: "resend", label: "Resend" }] },
      { key: "smtpUser", label: "SMTP user", placeholder: "you@gmail.com" },
      { key: "smtpPassword", label: "SMTP password", secret: true, help: "For Gmail: Google Account → Security → App passwords (16 characters)." },
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.gmail.com" },
      { key: "smtpPort", label: "SMTP port", type: "number", placeholder: "465" },
      { key: "resendApiKey", label: "Resend API key", secret: true, help: "Only sends to your own address until a domain is verified in Resend." },
      { key: "from", label: "From", placeholder: "Maison Oud <you@gmail.com>", help: "With Gmail SMTP this must be the Gmail address itself." },
    ] as FieldSpec[],
  },
  stripe: {
    title: "Stripe",
    blurb: "Cards, Apple Pay and Google Pay. Webhook: /api/webhooks/stripe",
    schema: z.object({ secretKey: str, publishableKey: str, webhookSecret: str }),
    fields: [
      { key: "publishableKey", label: "Publishable key", placeholder: "pk_live_…" },
      { key: "secretKey", label: "Secret key", secret: true },
      { key: "webhookSecret", label: "Webhook signing secret", secret: true },
    ] as FieldSpec[],
  },
  razorpay: {
    title: "Razorpay",
    blurb: "UPI, cards and netbanking. Webhook: /api/webhooks/razorpay",
    schema: z.object({ keyId: str, keySecret: str, webhookSecret: str }),
    fields: [
      { key: "keyId", label: "Key ID", placeholder: "rzp_live_…" },
      { key: "keySecret", label: "Key secret", secret: true },
      { key: "webhookSecret", label: "Webhook secret", secret: true },
    ] as FieldSpec[],
  },
  whatsapp: {
    title: "WhatsApp Business",
    blurb: "Order updates, COD confirmation and bag reminders via the WhatsApp Cloud API (Meta).",
    schema: z.object({ enabled: bool, phoneNumberId: str, businessAccountId: str, accessToken: str, appSecret: str, verifyToken: str, templateLanguage: z.string().trim().default("en") }),
    fields: [
      { key: "enabled", label: "Send WhatsApp messages", type: "boolean" },
      { key: "phoneNumberId", label: "Phone number ID" },
      { key: "businessAccountId", label: "WhatsApp Business account ID" },
      { key: "accessToken", label: "Permanent access token", secret: true },
      { key: "appSecret", label: "App secret (webhook signature)", secret: true },
      { key: "verifyToken", label: "Webhook verify token", secret: true, help: "Any random string; paste the same in Meta's webhook settings." },
      { key: "templateLanguage", label: "Template language code", placeholder: "en" },
    ] as FieldSpec[],
  },
  courier: {
    title: "Courier (Shiprocket)",
    blurb: "Live rates, AWB labels, pickups and tracking across Delhivery, Blue Dart, Xpressbees and more.",
    schema: z.object({ enabled: bool, email: str, password: str, pickupLocation: str, webhookToken: str }),
    fields: [
      { key: "enabled", label: "Use Shiprocket", type: "boolean" },
      { key: "email", label: "API user email", help: "Shiprocket → Settings → API → create an API user." },
      { key: "password", label: "API user password", secret: true },
      { key: "pickupLocation", label: "Pickup location name", placeholder: "Primary" },
      { key: "webhookToken", label: "Tracking webhook token", secret: true, help: "Sent by Shiprocket in the x-api-key header of tracking webhooks." },
    ] as FieldSpec[],
  },
  pixels: {
    title: "Analytics & ads",
    blurb: "GA4 and Meta Pixel in the browser, plus server-side purchase events (GA4 Measurement Protocol, Meta Conversions API).",
    schema: z.object({ enabled: bool, ga4MeasurementId: str, ga4ApiSecret: str, metaPixelId: str, metaCapiToken: str, metaTestEventCode: str }),
    fields: [
      { key: "enabled", label: "Load tracking (after cookie consent)", type: "boolean" },
      { key: "ga4MeasurementId", label: "GA4 measurement ID", placeholder: "G-XXXXXXX" },
      { key: "ga4ApiSecret", label: "GA4 Measurement Protocol secret", secret: true },
      { key: "metaPixelId", label: "Meta Pixel ID" },
      { key: "metaCapiToken", label: "Meta Conversions API token", secret: true },
      { key: "metaTestEventCode", label: "Meta test event code", help: "Optional; only while testing in Events Manager." },
    ] as FieldSpec[],
  },
} as const;

export type ProviderKey = keyof typeof PROVIDERS;
export type IntegrationValue<P extends ProviderKey> = z.infer<(typeof PROVIDERS)[P]["schema"]>;
export const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];
export const isProvider = (v: string): v is ProviderKey => (PROVIDER_KEYS as string[]).includes(v);

// ─────────────────────────────── Env fallback ───────────────────────────────

function fromEnv(p: ProviderKey): Record<string, unknown> {
  switch (p) {
    case "email":
      return { smtpHost: env.SMTP_HOST, smtpPort: env.SMTP_PORT, smtpUser: env.SMTP_USER ?? "", smtpPassword: env.SMTP_PASSWORD ?? "", resendApiKey: env.RESEND_API_KEY ?? "", from: env.EMAIL_FROM };
    case "stripe":
      return { secretKey: env.STRIPE_SECRET_KEY ?? "", publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "", webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "" };
    case "razorpay":
      return { keyId: env.RAZORPAY_KEY_ID ?? "", keySecret: env.RAZORPAY_KEY_SECRET ?? "", webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? "" };
    default:
      return {};
  }
}

// ─────────────────────────────── Encryption ───────────────────────────────

function key() {
  const dedicated = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  const ikm = dedicated && dedicated.length >= 16 ? dedicated : env.AUTH_SECRET;
  return Buffer.from(hkdfSync("sha256", ikm, "maison-oud/integrations", "integration-secrets-v1", 32));
}

type Sealed = { v: 1; iv: string; tag: string; ct: string };

function seal(provider: ProviderKey, data: Record<string, unknown>): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(provider));
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

function open(provider: ProviderKey, s: unknown): Record<string, unknown> | null {
  const parsed = z.object({ v: z.literal(1), iv: z.string(), tag: z.string(), ct: z.string() }).safeParse(s);
  if (!parsed.success) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(parsed.data.iv, "base64"));
    d.setAAD(Buffer.from(provider));
    d.setAuthTag(Buffer.from(parsed.data.tag, "base64"));
    const plain = Buffer.concat([d.update(Buffer.from(parsed.data.ct, "base64")), d.final()]).toString("utf8");
    return JSON.parse(plain) as Record<string, unknown>;
  } catch {
    // Wrong key (AUTH_SECRET rotated) or tampered row: behave as if nothing was saved.
    console.error(`[integrations] could not decrypt "${provider}" — re-enter it in Admin → Integrations`);
    return null;
  }
}

const settingKey = (p: ProviderKey) => `integration:${p}`;

// ─────────────────────────────── Read / write ───────────────────────────────

// Short in-process cache: these are read on hot paths (every email, every checkout).
const cache = new Map<ProviderKey, { at: number; value: unknown; saved: boolean }>();
const TTL = 30_000;

async function stored(p: ProviderKey) {
  try {
    const row = await db.setting.findUnique({ where: { key: settingKey(p) } });
    return row ? open(p, row.value) : null;
  } catch (e) {
    console.error(`[integrations] read failed for "${p}"`, e);
    return null;
  }
}

/** Effective config: saved values (non-empty fields) over environment variables over defaults. */
export async function getIntegration<P extends ProviderKey>(p: P): Promise<IntegrationValue<P>> {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < TTL) return hit.value as IntegrationValue<P>;
  const saved = await stored(p);
  const merged: Record<string, unknown> = { ...fromEnv(p) };
  for (const [k, v] of Object.entries(saved ?? {})) if (v !== "" && v !== null && v !== undefined) merged[k] = v;
  const value = PROVIDERS[p].schema.parse(merged) as IntegrationValue<P>;
  cache.set(p, { at: Date.now(), value, saved: Boolean(saved) });
  return value;
}

/**
 * Merge a partial update into the saved config. Secret fields left blank keep their saved value
 * (the UI never receives them, so it can't send them back); `clear` lists secrets to erase.
 */
export async function saveIntegration(p: ProviderKey, patch: Record<string, unknown>, clear: string[] = []) {
  const spec = PROVIDERS[p];
  const current = (await stored(p)) ?? {};
  const next: Record<string, unknown> = { ...current };
  for (const f of spec.fields) {
    if (!(f.key in patch)) continue;
    const v = patch[f.key];
    if (f.secret && (v === "" || v === undefined || v === null)) continue;
    next[f.key] = v;
  }
  for (const k of clear) if (spec.fields.some((f) => f.key === k && f.secret)) delete next[k];
  // Validate the merged shape (throws a ZodError the action turns into a message).
  spec.schema.parse({ ...fromEnv(p), ...next });
  await db.setting.upsert({
    where: { key: settingKey(p) },
    create: { key: settingKey(p), value: seal(p, next) },
    update: { value: seal(p, next) },
  });
  cache.delete(p);
}

const mask = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);

/** What the admin UI may see: plain values, secrets as ••••1234, and where each value comes from. */
export async function maskedIntegration(p: ProviderKey) {
  const saved = (await stored(p)) ?? {};
  const envVals = fromEnv(p);
  const effective = (await getIntegration(p)) as Record<string, unknown>;
  const fields = PROVIDERS[p].fields.map((f) => {
    const v = effective[f.key];
    const source = saved[f.key] !== undefined && saved[f.key] !== "" ? "saved" : envVals[f.key] ? "env" : "none";
    return {
      ...f,
      value: f.secret ? "" : v,
      preview: f.secret ? (typeof v === "string" && v ? mask(v) : "") : undefined,
      source,
    };
  });
  return { provider: p, title: PROVIDERS[p].title, blurb: PROVIDERS[p].blurb, fields };
}

/** Drop the cache (e.g. after a save in another server instance is noticed, or in tests). */
export const forgetIntegrations = () => cache.clear();
