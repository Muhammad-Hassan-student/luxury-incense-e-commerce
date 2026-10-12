"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useClientValue } from "@/lib/use-client";
import { ApiError, addPhoneLock, genericApiError, passkeysSupported, platformLockName, provePhoneLock, useApiErrorText, useLockLabel, type StepResult } from "./client";
import { FaceCapture } from "./face-capture";

export type ActionRes<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Email code entry. `send` is called once on mount (and on "Send a new code"). */
export function CodeStep({
  email,
  purpose,
  send,
  confirm,
  onTicket,
}: {
  email?: string;
  /** Why the code is sent; picks the sentence shown (see security.codeSent). */
  purpose: "setup" | "enroll" | "disable" | "confirm";
  send: () => Promise<ActionRes<{ devCode?: string | null }>>;
  confirm: (code: string) => Promise<ActionRes<{ ticket: string }>>;
  onTicket: (ticket: string) => void;
}) {
  const t = useTranslations("security");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const once = useRef(false);

  const doSend = () =>
    start(async () => {
      setError(null);
      const r = await send();
      if (!r.ok) return setError(r.error);
      setSent(true);
      setDevCode(r.devCode ?? null);
    });

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    doSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await confirm(code.replace(/\D/g, ""));
          if (!r.ok) return setError(r.error);
          onTicket(r.ticket);
        });
      }}
    >
      <p className="text-sm text-muted">
        {sent ? (
          t.rich("codeSent", { hasEmail: email ? "yes" : "no", email: email ?? "", purpose, b: (c) => <span className="text-fg">{c}</span> })
        ) : (
          error ? t("codeSendFailed") : t("codeSending")
        )}
      </p>
      {devCode && (
        <p className="border border-line p-3 text-xs text-subtle">
          Development only: email isn’t configured, so here is the code — <span className="font-mono text-base tracking-[0.3em] text-gold">{devCode}</span>
        </p>
      )}
      <Field label={t("codeLabel")}>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono text-lg tracking-[0.4em]"
          aria-describedby="code-error"
        />
      </Field>
      {error && (
        <p id="code-error" className="text-sm text-ember" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-6">
        <Button type="submit" disabled={pending || code.replace(/\D/g, "").length !== 6}>
          {pending ? t("checking") : t("confirmCode")}
        </Button>
        <button type="button" onClick={doSend} disabled={pending} className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          {t("sendNewCode")}
        </button>
      </div>
    </form>
  );
}

/** Choose and add a phone lock or a face, with a ticket from a confirmed email code. */
export function AddMethod({
  ticket,
  allow = { phone: true, face: true },
  onDone,
  onExpired,
}: {
  ticket: string;
  allow?: { phone: boolean; face: boolean };
  onDone: (r: StepResult) => void;
  onExpired: (message: string) => void;
}) {
  const t = useTranslations("security");
  const errorText = useApiErrorText();
  const [mode, setMode] = useState<"choose" | "face">("choose");
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const lockName = useLockLabel(useClientValue(() => platformLockName(), "phone lock"));
  const canPasskey = useClientValue(passkeysSupported, true);

  const handle = (e: unknown) => {
    const err = e instanceof ApiError ? e : genericApiError();
    if (err.status === 401 || err.status === 410) return onExpired(errorText(err));
    setError(errorText(err));
  };

  if (mode === "face") {
    return (
      <div className="space-y-6">
        <FaceCapture ticket={ticket} purpose="add" label={label} onDone={onDone} onError={(e) => (e.status === 401 || e.status === 410 ? (onExpired(errorText(e)), true) : false)} />
        <button type="button" onClick={() => setMode("choose")} className="link-draw mx-auto block text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          {t("back")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {allow.phone && (
        <div className="space-y-3 border border-line p-5">
          <p className="display text-2xl">{t("phoneLock")}</p>
          <p className="text-sm text-muted">{t("phoneLockBody", { lockName })}</p>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={pending || !canPasskey}
            onClick={() =>
              start(async () => {
                setError(null);
                try {
                  onDone(await addPhoneLock(ticket));
                } catch (e) {
                  handle(e);
                }
              })
            }
          >
            {pending ? t("waitingDevice") : t("addLock", { lockName })}
          </Button>
          {!canPasskey && <p className="text-xs text-subtle">{t("noPasskeySupport")}</p>}
        </div>
      )}
      {allow.face && (
        <div className="space-y-3 border border-line p-5">
          <p className="display text-2xl">{t("faceCheck")}</p>
          <p className="text-sm text-muted">{t("faceCheckBody", { max: 3 })}</p>
          <Field label={t("whoseFace")}>
            <Input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={t("whosePlaceholder")} />
          </Field>
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={() => setMode("face")}>
            {t("scanFace")}
          </Button>
        </div>
      )}
      {error && (
        <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Prove a saved method: phone lock first when saved, with the face check as the alternative (and vice versa). */
export function ProveMethod({
  ticket,
  methods,
  onDone,
  onExpired,
}: {
  ticket: string;
  methods: { phone: boolean; face: boolean };
  onDone: (r: StepResult) => void;
  onExpired: (message: string) => void;
}) {
  const t = useTranslations("security");
  const errorText = useApiErrorText();
  const [mode, setMode] = useState<"phone" | "face">(methods.phone ? "phone" : "face");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, start] = useTransition();
  const lockName = useLockLabel(useClientValue(() => platformLockName(), "phone lock"));

  const onApiError = (e: ApiError) => {
    if (e.status === 401 && !("triesLeft" in e.data)) {
      onExpired(errorText(e));
      return true;
    }
    if (e.status === 423) setLocked(true);
    return false;
  };

  return (
    <div className="space-y-6">
      {mode === "phone" ? (
        <div className="space-y-5">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={pending || locked}
            onClick={() =>
              start(async () => {
                setError(null);
                try {
                  onDone(await provePhoneLock(ticket));
                } catch (e) {
                  const err = e instanceof ApiError ? e : genericApiError();
                  // The server's own wording ("… 3 tries left.", "Too many tries …") is shown as-is.
                  if (!onApiError(err)) setError(errorText(err));
                }
              })
            }
          >
            {pending ? t("waitingDevice") : t("useLock", { lockName })}
          </Button>
          {error && (
            <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <FaceCapture ticket={ticket} purpose="prove" onDone={onDone} onError={onApiError} />
      )}
      {methods.phone && methods.face && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "phone" ? "face" : "phone");
          }}
          className="link-draw mx-auto block text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg"
        >
          {mode === "phone" ? t("useFaceInstead") : t("useLockInstead", { lockName })}
        </button>
      )}
    </div>
  );
}
