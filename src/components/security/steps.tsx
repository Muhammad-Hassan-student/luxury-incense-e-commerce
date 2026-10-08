"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useClientValue } from "@/lib/use-client";
import { ApiError, addPhoneLock, passkeysSupported, platformLockName, provePhoneLock, type StepResult } from "./client";
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
  purpose: string;
  send: () => Promise<ActionRes<{ devCode?: string | null }>>;
  confirm: (code: string) => Promise<ActionRes<{ ticket: string }>>;
  onTicket: (ticket: string) => void;
}) {
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
          <>
            We emailed a 6-digit code{email ? <> to <span className="text-fg">{email}</span></> : null} {purpose}. It works once and expires in 10 minutes.
          </>
        ) : (
          error ? "We couldn’t send a code just now." : "Sending you a code…"
        )}
      </p>
      {devCode && (
        <p className="border border-line p-3 text-xs text-subtle">
          Development only: email isn’t configured, so here is the code — <span className="font-mono text-base tracking-[0.3em] text-gold">{devCode}</span>
        </p>
      )}
      <Field label="Code from your email">
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
          {pending ? "Checking…" : "Confirm code"}
        </Button>
        <button type="button" onClick={doSend} disabled={pending} className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          Send a new code
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
  const [mode, setMode] = useState<"choose" | "face">("choose");
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const lockName = useClientValue(() => platformLockName(), "phone lock");
  const canPasskey = useClientValue(passkeysSupported, true);

  const handle = (e: unknown) => {
    const err = e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0);
    if (err.status === 401 || err.status === 410) return onExpired(err.message);
    setError(err.message);
  };

  if (mode === "face") {
    return (
      <div className="space-y-6">
        <FaceCapture ticket={ticket} purpose="add" label={label} onDone={onDone} onError={(e) => (e.status === 401 || e.status === 410 ? (onExpired(e.message), true) : false)} />
        <button type="button" onClick={() => setMode("choose")} className="link-draw mx-auto block text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {allow.phone && (
        <div className="space-y-3 border border-line p-5">
          <p className="display text-2xl">Phone lock</p>
          <p className="text-sm text-muted">Use this device’s own lock — {lockName} — to confirm it’s you. Nothing about your fingerprint or face leaves the device.</p>
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
            {pending ? "Waiting for your device…" : `Add ${lockName}`}
          </Button>
          {!canPasskey && <p className="text-xs text-subtle">This browser doesn’t support phone locks.</p>}
        </div>
      )}
      {allow.face && (
        <div className="space-y-3 border border-line p-5">
          <p className="display text-2xl">Camera face check</p>
          <p className="text-sm text-muted">We save a coded description of your face (128 numbers, encrypted) — never a photo. Up to 3 faces per account.</p>
          <Field label="Whose face? (optional)">
            <Input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Me" />
          </Field>
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={() => setMode("face")}>
            Scan my face
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
  const [mode, setMode] = useState<"phone" | "face">(methods.phone ? "phone" : "face");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, start] = useTransition();
  const lockName = useClientValue(() => platformLockName(), "phone lock");

  const onApiError = (e: ApiError) => {
    if (e.status === 401 && !("triesLeft" in e.data)) {
      onExpired(e.message);
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
                  const err = e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0);
                  // The server's own wording ("… 3 tries left.", "Too many tries …") is shown as-is.
                  if (!onApiError(err)) setError(err.message);
                }
              })
            }
          >
            {pending ? "Waiting for your device…" : `Use ${lockName}`}
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
          {mode === "phone" ? "Use the camera face check instead" : `Use ${lockName} instead`}
        </button>
      )}
    </div>
  );
}
