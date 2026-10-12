import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { aiClient, fallbackParams, supportsEffort, textOf, usageOf, type AiMessageParam, type AiToolResult } from "./client";
import { getAiFeatures, mockReasonText, recordUsage, resolveAiMode, estimateCostMicros } from "./config";
import { conciergeRateLimit, hashId, LIMITS, redactPII } from "./guard";
import { mockAnswer } from "./mock";
import { conciergeSystemBlocks, turnContext } from "./prompt";
import { catalogueDigest, executeTool, loadCatalogue, TOOL_DEFS, type BagView, type ConciergeProduct, type ToolContext, type ToolOutcome } from "./tools";

/** Streaming events sent to the storefront (NDJSON, one per line). */
export type ConciergeEvent =
  | { type: "start"; conversationId: string; mode: "live" | "mock" }
  | { type: "notice"; text: string }
  | { type: "text"; text: string }
  | { type: "products"; items: ConciergeProduct[] }
  | { type: "bag"; bag: BagView }
  | { type: "done"; messageId: string }
  | { type: "error"; code: "unavailable" | "invalid" | "rate_limited" | "turn_limit" | "failed"; text: string };

export type ConciergeWho = {
  userId: string | null;
  /** Random id from the guest's httpOnly cookie (only its hash is stored). */
  guestId: string | null;
  ip: string;
  locale: string;
  page?: string | null;
};

const FRIENDLY = {
  invalid: "Could you say that again in a few words?",
  rate: "You’re quicker than our smoke — give me a moment and ask again.",
  turns: "We’ve covered a lot! Start a new chat, or tap “Talk to a person” and our care team will pick it up.",
  unavailable: "The perfumer is away just now.",
  failed: "Something went wrong on our side. Please try again.",
  apiDown: "The perfumer is briefly unavailable — here’s what I can find in the catalogue meanwhile.",
  refusal: "I can’t help with that one, but I’d love to help you find a fragrance.",
  limit: "Let me keep this short — ask me to narrow it down if you’d like more.",
};

async function ownConversation(id: string | undefined, who: ConciergeWho) {
  if (!id) return null;
  const c = await db.aiConversation.findUnique({ where: { id } });
  if (!c) return null;
  if (who.userId) return c.userId === who.userId ? c : null;
  return !c.userId && who.guestId && c.guestKey === hashId(`guest:${who.guestId}`) ? c : null;
}

/** Cards to show: products the answer names (in order), else the first few the tools returned. */
export function pickCards(text: string, outcomes: { outcome: ToolOutcome }[], max = 3) {
  const seen = new Map<string, ConciergeProduct>();
  for (const o of outcomes) for (const p of o.outcome.products ?? []) if (!seen.has(p.id)) seen.set(p.id, p);
  const all = [...seen.values()];
  const lower = text.toLowerCase();
  const named = all
    .map((p) => ({ p, at: lower.indexOf(p.name.toLowerCase()) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
  return (named.length ? named : all).slice(0, max);
}

/**
 * One shopper turn: guardrails → conversation → live Claude (tools, streaming) or Mock mode → stored answer.
 * Never throws to the caller; every failure becomes a friendly event.
 */
export async function runConciergeTurn(
  input: { conversationId?: string; message: string },
  who: ConciergeWho,
  ctx: ToolContext,
  emit: (e: ConciergeEvent) => void,
  opts: { signal?: AbortSignal; now?: Date } = {},
) {
  const message = (input.message ?? "").trim();
  if (!(await getAiFeatures()).concierge) return emit({ type: "error", code: "unavailable", text: FRIENDLY.unavailable });
  if (!message || message.length > LIMITS.maxMessageChars) return emit({ type: "error", code: "invalid", text: FRIENDLY.invalid });

  const identity = who.userId ? `user:${who.userId}` : `guest:${who.guestId ?? who.ip}`;
  if (!(await conciergeRateLimit(identity, who.ip, opts.now?.getTime())).ok) return emit({ type: "error", code: "rate_limited", text: FRIENDLY.rate });

  let convo = await ownConversation(input.conversationId, who);
  if (convo && convo.turns >= LIMITS.maxTurns) return emit({ type: "error", code: "turn_limit", text: FRIENDLY.turns });
  convo ??= await db.aiConversation.create({
    data: { userId: who.userId, guestKey: who.userId ? null : who.guestId ? hashId(`guest:${who.guestId}`) : null, locale: who.locale.slice(0, 8) },
  });

  const history = await db.aiMessage.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: "desc" }, take: LIMITS.historyMessages, select: { role: true, content: true } });
  await db.aiMessage.create({ data: { conversationId: convo.id, role: "user", content: redactPII(message).slice(0, 4000) } });

  const mode = await resolveAiMode(opts.now);
  emit({ type: "start", conversationId: convo.id, mode: mode.live ? "live" : "mock" });

  let answer = "";
  let used: { name: string; outcome: ToolOutcome }[] = [];
  let finalMode: "live" | "mock" = mode.live ? "live" : "mock";
  const onBag = (o: ToolOutcome) => o.bag && emit({ type: "bag", bag: o.bag });

  if (mode.live) {
    try {
      const r = await runLive({ apiKey: mode.apiKey, model: mode.models.concierge, budgetMicros: mode.capMicros > 0 ? mode.capMicros - mode.spentMicros : Infinity }, message, history.reverse(), who, ctx, emit, onBag, opts.signal);
      answer = r.text;
      used = r.used;
    } catch (e) {
      // API down, bad key, timeout… degrade to Mock mode for this turn. Never log the conversation itself.
      console.error("[ai] concierge call failed", e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : e instanceof Error ? e.name : "error");
      finalMode = "mock";
      emit({ type: "notice", text: FRIENDLY.apiDown });
    }
  } else {
    emit({ type: "notice", text: mockReasonText[mode.reason] });
  }

  if (finalMode === "mock") {
    const m = await mockAnswer(message, ctx);
    used = m.outcomes;
    answer = m.text;
    emit({ type: "text", text: m.text });
    m.outcomes.forEach((o) => onBag(o.outcome));
    await recordUsage({ feature: "concierge", model: "mock", mock: true, actorId: who.userId });
  }

  const cards = pickCards(answer, used, finalMode === "mock" ? 3 : 4);
  if (cards.length) emit({ type: "products", items: cards });

  const saved = await db.aiMessage.create({
    data: {
      conversationId: convo.id,
      role: "assistant",
      content: redactPII(answer).slice(0, 8000),
      productIds: cards.map((c) => c.id),
      tools: used.map((u) => ({ name: u.name, ok: u.outcome.ok })),
      mode: finalMode,
    },
  });
  await db.aiConversation.update({ where: { id: convo.id }, data: { turns: { increment: 1 }, mode: finalMode } });
  emit({ type: "done", messageId: saved.id });
}

async function runLive(
  cfg: { apiKey: string; model: string; budgetMicros: number },
  message: string,
  history: { role: string; content: string }[],
  who: ConciergeWho,
  ctx: ToolContext,
  emit: (e: ConciergeEvent) => void,
  onBag: (o: ToolOutcome) => void,
  signal?: AbortSignal,
) {
  const client = aiClient(cfg.apiKey);
  const system = conciergeSystemBlocks(catalogueDigest(await loadCatalogue()));

  // Earlier turns as plain text (no thinking blocks are replayed across turns), starting with a user turn.
  const past: AiMessageParam[] = history.map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), content: h.content }));
  while (past.length && past[0].role !== "user") past.shift();
  const messages: AiMessageParam[] = [...past, { role: "user", content: `${turnContext({ signedIn: Boolean(who.userId), locale: who.locale, page: who.page })}\n\n${message}` }];

  const used: { name: string; outcome: ToolOutcome }[] = [];
  let text = "";
  let spent = 0;
  for (let round = 0; round < LIMITS.maxToolRounds; round++) {
    const msg = await client.run(
      {
        model: cfg.model,
        max_tokens: LIMITS.maxOutputTokens,
        system,
        tools: TOOL_DEFS,
        messages,
        cache_control: { type: "ephemeral" },
        ...(supportsEffort(cfg.model) && { output_config: { effort: "low" as const } }),
        ...fallbackParams(cfg.model),
        metadata: { user_id: hashId(who.userId ? `user:${who.userId}` : `guest:${who.guestId ?? who.ip}`) },
      },
      {
        signal,
        onText: (delta) => {
          text += delta;
          emit({ type: "text", text: delta });
        },
      },
    );
    const usage = usageOf(msg);
    spent += estimateCostMicros(msg.model ?? cfg.model, usage);
    await recordUsage({ feature: "concierge", model: msg.model ?? cfg.model, usage, actorId: who.userId });

    if (msg.stop_reason === "refusal") {
      const t = (text ? "\n\n" : "") + FRIENDLY.refusal;
      text += t;
      emit({ type: "text", text: t });
      break;
    }
    const calls = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) {
      if (!text) text = textOf(msg);
      break;
    }
    if (msg.stop_reason === "max_tokens" || round === LIMITS.maxToolRounds - 1 || spent >= cfg.budgetMicros) {
      // Never run tools on a truncated input, and stop looping at the round / budget limits.
      const t = (text ? "\n\n" : "") + FRIENDLY.limit;
      text += t;
      emit({ type: "text", text: t });
      break;
    }

    // Append the assistant turn unchanged (thinking / fallback blocks included), then all results in one user turn.
    messages.push({ role: "assistant", content: msg.content });
    const results: AiToolResult[] = [];
    for (const call of calls) {
      const outcome = await executeTool(call.name, call.input, ctx);
      used.push({ name: call.name, outcome });
      onBag(outcome);
      // Tool output is data: JSON only, flagged as untrusted, never instructions.
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: !outcome.ok, content: JSON.stringify({ untrusted_data: outcome.result }) });
    }
    messages.push({ role: "user", content: results });
    if (text && !/\s$/.test(text)) {
      text += "\n\n";
      emit({ type: "text", text: "\n\n" });
    }
  }
  return { text: text.trim(), used };
}

/** "Was this helpful?" — only the conversation's owner can answer. */
export async function recordFeedback(conversationId: string, helpful: boolean, note: string | null, who: Pick<ConciergeWho, "userId" | "guestId">) {
  const c = await ownConversation(conversationId, { ...who, ip: "", locale: "en" });
  if (!c) return false;
  await db.aiConversation.update({ where: { id: c.id }, data: { helpful, feedbackNote: note ? redactPII(note).slice(0, 500) : null } });
  return true;
}

export async function ownsConversation(conversationId: string, who: Pick<ConciergeWho, "userId" | "guestId">) {
  return Boolean(await ownConversation(conversationId, { ...who, ip: "", locale: "en" }));
}
