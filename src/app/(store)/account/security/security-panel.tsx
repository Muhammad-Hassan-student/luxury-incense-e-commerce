"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddMethod, CodeStep, ProveMethod } from "@/components/security/steps";
import type { StepResult } from "@/components/security/client";
import { cn } from "@/lib/utils";
import { confirmManageCodeAction, createEnrollLinkAction, lockNowAction, removeMethodAction, sendManageCodeAction, setMethodAction, turnOnAction } from "./actions";

type Summary = { enabled: boolean; required: boolean; effective: boolean; phoneLockEnabled: boolean; faceEnabled: boolean; lockedUntil: string | null };
type Key = { id: string; name: string; here: boolean; createdAt: string; lastUsedAt: string | null; synced: boolean };
type Face = { id: string; label: string; createdAt: string; lastUsedAt: string | null };
type Flow = { kind: "setup" | "add" | "disable"; ticket: string | null } | null;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center border transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-gold bg-gold/20" : "border-line-strong bg-transparent",
      )}
    >
      <span className={cn("absolute size-4 transition-transform duration-300", checked ? "translate-x-[1.6rem] bg-gold" : "translate-x-[0.3rem] bg-subtle")} />
    </button>
  );
}

export function SecurityPanel({ email, status, summary, passkeys, faces, maxFaces }: { email: string; status: string; summary: Summary; passkeys: Key[]; faces: Face[]; maxFaces: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const openLock = () => {
    router.replace(`/signin/verify?callbackUrl=${encodeURIComponent(pathname)}`);
    router.refresh();
  };
  const [flow, setFlow] = useState<Flow>(null);
  const [pending, start] = useTransition();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const usableKeys = passkeys.filter((k) => k.here);
  const methods = { phone: summary.phoneLockEnabled && usableKeys.length > 0, face: summary.faceEnabled && faces.length > 0 };

  const refresh = () => router.refresh();
  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        refresh();
      } else toast.error(r.error);
    });

  const onMaster = (next: boolean) => {
    if (next) {
      start(async () => {
        const r = await turnOnAction();
        if (!r.ok) return void toast.error(r.error);
        if (r.needsSetup) setFlow({ kind: "setup", ticket: null });
        else {
          toast.success(r.message ?? "Face ID is now on for your sign-ins");
          openLock();
        }
      });
    } else setFlow({ kind: "disable", ticket: null });
  };

  const finishFlow = (r: StepResult) => {
    const kind = flow?.kind;
    setFlow(null);
    if (r.done === "disabled") toast.success("Face ID / phone lock is now off. Your saved faces and keys are kept.");
    else if (kind === "setup") toast.success("Face ID is now on for your sign-ins");
    else toast.success("Saved. It’ll be asked for at your next sign-in.");
    refresh();
  };

  const onExpired = (message: string) => {
    toast.error(message);
    setFlow(null);
  };

  return (
    <div className="space-y-10 pt-6">
      {/* Master switch */}
      <section className="border border-line p-5 md:p-7">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-base text-fg">Ask for Face ID / phone lock when I sign in</p>
            <p className="mt-2 text-sm text-gold" data-testid="security-status">{status}</p>
            {summary.required && <p className="mt-2 text-xs text-subtle">Required by the store for your account, so it can’t be switched off.</p>}
            {summary.lockedUntil && <p className="mt-2 text-xs text-ember">Locked after too many wrong tries until {new Date(summary.lockedUntil).toLocaleTimeString()}.</p>}
          </div>
          <Switch
            checked={summary.effective}
            label="Ask for Face ID / phone lock when I sign in"
            disabled={pending || Boolean(flow) || (summary.required && summary.effective)}
            onChange={onMaster}
          />
        </div>

        {!flow && (!summary.effective || (!methods.phone && !methods.face)) && (
          <Button className="mt-6 tracking-[0.14em]" disabled={pending} onClick={() => onMaster(true)}>
            {pending ? "Opening…" : methods.phone || methods.face ? "Turn on security lock" : "Set up security lock"}
          </Button>
        )}

        {flow && (
          <div className="mt-8 border-t border-line pt-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <p className="eyebrow">{flow.kind === "disable" ? "Switch off" : flow.kind === "setup" ? "Set up" : "Add a method"}</p>
              <button type="button" onClick={() => setFlow(null)} className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
                Cancel
              </button>
            </div>
            {!flow.ticket ? (
              <CodeStep
                email={email}
                purpose={flow.kind === "disable" ? "to switch the lock off" : "to confirm it’s you"}
                send={sendManageCodeAction}
                confirm={(code) => confirmManageCodeAction(code, flow.kind === "disable" ? "disable" : flow.kind === "setup" ? "add+enable" : "add")}
                onTicket={(ticket) => setFlow({ ...flow, ticket })}
              />
            ) : flow.kind === "disable" ? (
              <div className="space-y-4">
                <p className="text-sm text-muted">Now confirm with one of your saved methods.</p>
                <ProveMethod ticket={flow.ticket} methods={methods} onDone={finishFlow} onExpired={onExpired} />
              </div>
            ) : (
              <AddMethod ticket={flow.ticket} allow={{ phone: true, face: faces.length < maxFaces }} onDone={finishFlow} onExpired={onExpired} />
            )}
          </div>
        )}
      </section>

      {summary.effective && (methods.phone || methods.face) && !flow && (
        <section className="flex flex-wrap items-center justify-between gap-5 border border-gold/30 bg-gold/5 p-5 md:p-7">
          <div>
            <p className="display text-2xl">Lock this device</p>
            <p className="mt-2 text-sm text-muted">Lock now to require your saved Face ID, phone lock or face check before continuing.</p>
          </div>
          <Button type="button" disabled={pending} onClick={() => start(async () => {
            const r = await lockNowAction();
            if (r.ok) openLock();
            else toast.error(r.error);
          })}>Lock now</Button>
        </section>
      )}

      {/* Per-method toggles + saved items */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="border border-line p-5 md:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="display text-2xl">Phone lock</p>
              <p className="text-xs text-subtle">Face ID, fingerprint, Windows Hello</p>
            </div>
            <Switch checked={summary.phoneLockEnabled} label="Phone lock" disabled={pending} onChange={(v) => act(() => setMethodAction("phone", v))} />
          </div>
          <ul className="mt-6 divide-y divide-line">
            {passkeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{k.name}</p>
                  <p className="text-xs text-subtle">
                    Added {fmt(k.createdAt)} · last used {fmt(k.lastUsedAt)}
                    {!k.here && " · for another site"}
                  </p>
                </div>
                <button type="button" disabled={pending} onClick={() => act(() => removeMethodAction("phone", k.id))} className="shrink-0 text-xs text-muted hover:text-ember">
                  Remove
                </button>
              </li>
            ))}
            {!passkeys.length && <li className="py-3 text-sm text-subtle">No phone lock saved yet.</li>}
          </ul>
          <Button variant="outline" size="sm" className="mt-4" disabled={pending || Boolean(flow)} onClick={() => setFlow({ kind: summary.effective ? "add" : "setup", ticket: null })}>
            Add a phone lock
          </Button>
        </div>

        <div className="border border-line p-5 md:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="display text-2xl">Camera face check</p>
              <p className="text-xs text-subtle">
                {faces.length} of {maxFaces} faces saved
              </p>
            </div>
            <Switch checked={summary.faceEnabled} label="Camera face check" disabled={pending} onChange={(v) => act(() => setMethodAction("face", v))} />
          </div>
          <ul className="mt-6 divide-y divide-line">
            {faces.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{f.label}</p>
                  <p className="text-xs text-subtle">
                    Added {fmt(f.createdAt)} · last used {fmt(f.lastUsedAt)}
                  </p>
                </div>
                <button type="button" disabled={pending} onClick={() => act(() => removeMethodAction("face", f.id))} className="shrink-0 text-xs text-muted hover:text-ember">
                  Remove
                </button>
              </li>
            ))}
            {!faces.length && <li className="py-3 text-sm text-subtle">No face saved yet.</li>}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={pending || Boolean(flow) || faces.length >= maxFaces}
            onClick={() => setFlow({ kind: summary.effective ? "add" : "setup", ticket: null })}
          >
            {faces.length >= maxFaces ? "3 faces saved" : "Add a face"}
          </Button>
        </div>
      </section>

      {/* Enrollment link */}
      <section className="border border-line p-5 md:p-7">
        <p className="display text-2xl">Add someone else or another phone</p>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Make a one-time link (30 minutes). Whoever opens it confirms this account’s email with a code, then adds their phone lock or face here. The link never
          signs anyone in.
        </p>
        {link ? (
          <div className="mt-5 space-y-4">
            <p className="break-all border border-line bg-bg-elev p-3 font-mono text-xs text-fg" data-testid="enroll-link">
              {link.url}
            </p>
            <p className="text-xs text-subtle">Works once, until {new Date(link.expiresAt).toLocaleTimeString()}.</p>
            <div className="flex flex-wrap gap-3">
              <Button
                size="sm"
                type="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link.url)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Couldn’t copy — select the link and copy it."))
                }
              >
                Copy
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Add your phone or face to my Maison Oud account (one-time link, 30 min): ${link.url}`)}`} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-5"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createEnrollLinkAction();
                if (r.ok) setLink({ url: r.url, expiresAt: r.expiresAt });
                else toast.error(r.error);
              })
            }
          >
            Create a one-time link
          </Button>
        )}
      </section>

      <p className="text-xs text-subtle">
        The camera face check stops photos and replays, not a determined expert — that’s why it’s only ever asked for after your sign-in link, never instead of
        it. We store a coded, encrypted description of each face, never a photo.
      </p>
    </div>
  );
}
