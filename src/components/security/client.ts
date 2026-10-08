"use client";

import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";

/** Error carrying the server's own wording (e.g. "That doesn’t look like you. 3 tries left."). Never replaced. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function postJson<T = Record<string, unknown>>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store", signal });
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : `Request failed (${res.status}).`, res.status, data);
  return data as T;
}

/** What the phone lock is called on this device, for the button label. */
export function platformLockName(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  if (/iPhone|iPad/i.test(ua)) return "Face ID";
  if (/Android/i.test(ua)) return "fingerprint";
  if (/Windows/i.test(ua)) return "Windows Hello";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Touch ID";
  return "phone lock";
}

export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

function friendly(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof WebAuthnError && e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") throw new ApiError("This device is already saved as a phone lock.", 0);
  if (e instanceof WebAuthnError || (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError"))) {
    throw new ApiError("The phone lock was cancelled or timed out. Try again when you’re ready.", 0, { cancelled: true });
  }
  if (e instanceof Error && e.name === "InvalidStateError") throw new ApiError("This device is already saved as a phone lock.", 0);
  throw new ApiError("Your browser couldn’t use the phone lock. Try the camera face check instead.", 0);
}

export type StepResult = { ok: true; done: "signin" | "disabled" | "added" | "enrolled" };

export async function addPhoneLock(ticket: string, name?: string): Promise<StepResult> {
  const { options } = await postJson<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/security/passkey/options", { ticket, purpose: "register" });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    friendly(e);
  }
  return postJson<StepResult>("/api/security/passkey/verify", { ticket, purpose: "register", response, name });
}

export async function provePhoneLock(ticket: string): Promise<StepResult> {
  const { options } = await postJson<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/security/passkey/options", { ticket, purpose: "authenticate" });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    friendly(e);
  }
  return postJson<StepResult>("/api/security/passkey/verify", { ticket, purpose: "authenticate", response });
}
