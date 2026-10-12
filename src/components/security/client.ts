"use client";

import { useTranslations } from "next-intl";
import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";

/**
 * Error carrying the server's own wording (e.g. "That doesn’t look like you. 3 tries left."). Never replaced.
 * Errors raised in the browser carry `data.clientCode` instead, so the UI can show them in the visitor's language
 * (see useApiErrorText).
 */
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
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0, { clientCode: "offline" });
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (typeof data.error === "string") throw new ApiError(data.error, res.status, data);
    throw new ApiError(`Request failed (${res.status}).`, res.status, { ...data, clientCode: "requestFailed" });
  }
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

/** A generic "something went wrong" error for unexpected failures. */
export const genericApiError = () => new ApiError("Something went wrong. Please try again.", 0, { clientCode: "generic" });

const CLIENT_CODES = ["generic", "offline", "requestFailed", "alreadySaved", "cancelled", "browser"] as const;
const FACE_CODES = ["cameraStopped", "probeStopped", "insecure", "noCameraApi", "noCamera", "cameraBusy", "cameraDenied", "noStart", "previewFailed"] as const;
export type FaceErrorCode = (typeof FACE_CODES)[number];

/** Shows browser-side errors in the visitor's language; the server's own wording is shown as-is. */
export function useApiErrorText() {
  const t = useTranslations("security");
  const tf = useTranslations("faceCheck");
  return (e: ApiError) => {
    const code = e.data.clientCode;
    if ((CLIENT_CODES as readonly unknown[]).includes(code)) return t(`err_${code as (typeof CLIENT_CODES)[number]}`, { status: e.status });
    if ((FACE_CODES as readonly unknown[]).includes(code)) return tf(`err_${code as FaceErrorCode}`);
    return e.message;
  };
}

/** The lock's name for button labels, in the visitor's language where it isn't a product name. */
export function useLockLabel(name: string) {
  const t = useTranslations("security");
  return name === "fingerprint" ? t("lockFingerprint") : name === "phone lock" ? t("lockGeneric") : name;
}

export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

function friendly(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof WebAuthnError && e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") throw new ApiError("This device is already saved as a phone lock.", 0, { clientCode: "alreadySaved" });
  if (e instanceof WebAuthnError || (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError"))) {
    throw new ApiError("The phone lock was cancelled or timed out. Try again when you’re ready.", 0, { cancelled: true, clientCode: "cancelled" });
  }
  if (e instanceof Error && e.name === "InvalidStateError") throw new ApiError("This device is already saved as a phone lock.", 0, { clientCode: "alreadySaved" });
  throw new ApiError("Your browser couldn’t use the phone lock. Try the camera face check instead.", 0, { clientCode: "browser" });
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
