import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "./config";

/**
 * The only door to the Claude API. Features depend on this narrow interface, so tests inject a scripted fake
 * (`setAiClientFactory`) and never touch the network.
 */

export type AiParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type AiMessage = Anthropic.Beta.Messages.BetaMessage;
export type AiMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type AiTool = Anthropic.Beta.Messages.BetaTool;
export type AiToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export interface AiClient {
  /** Streams one model turn (text deltas to `onText`) and resolves with the complete message. */
  run(params: AiParams, opts?: { onText?: (delta: string) => void; signal?: AbortSignal }): Promise<AiMessage>;
}

class AnthropicAiClient implements AiClient {
  private sdk: Anthropic;
  constructor(apiKey: string) {
    // Short timeout + one retry: a shopper is waiting. Errors fall back to Mock mode upstream.
    this.sdk = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }
  async run(params: AiParams, opts: { onText?: (delta: string) => void; signal?: AbortSignal } = {}) {
    const stream = this.sdk.beta.messages.stream(params, { signal: opts.signal });
    if (opts.onText) stream.on("text", opts.onText);
    return stream.finalMessage();
  }
}

type Factory = (apiKey: string) => AiClient;
let factory: Factory = (apiKey) => new AnthropicAiClient(apiKey);

/** Tests: replace the client (e.g. a scripted fake). Pass null to restore the real one. */
export function setAiClientFactory(f: Factory | null) {
  factory = f ?? ((apiKey) => new AnthropicAiClient(apiKey));
}

export const aiClient = (apiKey: string) => factory(apiKey);

/** Models that accept `output_config.effort` (Haiku 4.5 and older do not). */
export const supportsEffort = (model: string) => !/haiku-4|sonnet-4-5|opus-4-5|claude-3/.test(model);

/** Server-side refusal fallback ("default" routing) on the models that support it, Claude API only. */
export function fallbackParams(model: string): Pick<AiParams, "betas" | "fallbacks"> {
  return /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

export function usageOf(m: AiMessage): TokenUsage {
  return {
    inputTokens: m.usage.input_tokens ?? 0,
    outputTokens: m.usage.output_tokens ?? 0,
    cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0,
  };
}

export const textOf = (m: AiMessage) =>
  m.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
