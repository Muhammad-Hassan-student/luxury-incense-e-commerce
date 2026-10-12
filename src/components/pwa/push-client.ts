"use client";

/* Browser side of web push: support detection, subscribe / unsubscribe against /api/push/subscription. */

export type PushSupport = "supported" | "unsupported" | "ios-needs-install" | "denied";

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  // iOS only offers web push to apps added to the home screen (16.4+).
  if (isIOS() && !isStandalone()) return "ios-needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

export async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export async function currentSubscription() {
  try {
    const reg = await registration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function keyBytes(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type EnableResult = { ok: true } | { ok: false; reason: "unsupported" | "denied" | "signin" | "disabled" | "failed" | "ios-needs-install" };

/** Must be called from a click (permission prompts need a user gesture). */
export async function enablePush(locale: string): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== "supported") return { ok: false, reason: support === "denied" ? "denied" : support };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const cfg = (await (await fetch("/api/push/subscription", { cache: "no-store" })).json()) as { enabled: boolean; publicKey: string | null };
    if (!cfg.enabled || !cfg.publicKey) return { ok: false, reason: "disabled" };
    const reg = await registration();
    if (!reg) return { ok: false, reason: "unsupported" };
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with an older key can't receive our pushes: replace it.
    const wanted = keyBytes(cfg.publicKey);
    const existingKey = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (sub && existingKey && (existingKey.length !== wanted.length || existingKey.some((b, i) => b !== wanted[i]))) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
    const res = await fetch("/api/push/subscription", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), locale }) });
    if (res.status === 401) return { ok: false, reason: "signin" };
    return res.ok ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscription", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** localStorage that never throws (private mode, blocked storage). */
export const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};
