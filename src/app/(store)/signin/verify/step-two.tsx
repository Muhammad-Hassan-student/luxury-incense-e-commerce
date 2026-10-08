"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AddMethod, CodeStep, ProveMethod } from "@/components/security/steps";
import type { StepResult } from "@/components/security/client";
import { beginStepTwo, cancelStepTwo, confirmSetupCodeAction, sendSetupCodeAction, type StepTwoStart } from "../actions";

type Initial = "verify" | "setup" | "expired" | "none" | "done";

export function StepTwo({ initial, email, callbackUrl }: { initial: Initial; email: string | null; callbackUrl: string }) {
  const [start, setStart] = useState<StepTwoStart | null>(null);
  const [setupTicket, setSetupTicket] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(initial === "expired" || initial === "none" ? "This sign-in has expired." : null);
  const [finished, setFinished] = useState(initial === "done");

  const load = useCallback(() => {
    beginStepTwo()
      .then((s) => {
        setStart(s);
        if (s.state === "expired" || s.state === "none") setExpired("This sign-in has expired.");
        if (s.state === "done") setFinished(true);
      })
      .catch(() => setExpired("Too many requests. Wait a minute, then request a new sign-in link."));
  }, []);

  useEffect(() => {
    // Always ask the server: it also clears a stale pending cookie so the visitor isn't trapped here.
    load();
  }, [load]);

  useEffect(() => {
    // Full navigation so every server component re-reads the (now verified) session.
    if (finished) window.location.assign(callbackUrl);
  }, [finished, callbackUrl]);

  const onDone = (r: StepResult) => {
    if (r.done === "signin") setFinished(true);
  };
  const onExpired = (message: string) => setExpired(message);

  if (finished) return <p className="text-muted">Signing you in…</p>;

  if (expired) {
    return (
      <div className="space-y-6 border border-line p-6">
        <p className="text-sm text-muted">{expired} Request a new sign-in link to try again.</p>
        <form action={cancelStepTwo}>
          <Button type="submit" className="w-full">Request a new link</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!start && <p className="text-sm text-muted">Getting ready…</p>}
      {start?.state === "unavailable" && (
        <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
          Your security lock is on, but no saved method is available on this site. Open the original site where you saved your phone lock, or contact the store for help.
        </p>
      )}

      {start?.state === "verify" &&
        (start.lockedMinutes ? (
          <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
            Too many tries. Try again in {start.lockedMinutes} minute{start.lockedMinutes === 1 ? "" : "s"}.
          </p>
        ) : (
          <ProveMethod ticket={start.ticket} methods={start.methods} onDone={onDone} onExpired={onExpired} />
        ))}

      {start?.state === "setup" &&
        (setupTicket ? (
          <AddMethod ticket={setupTicket} onDone={onDone} onExpired={onExpired} />
        ) : (
          <CodeStep email={email ?? undefined} purpose="to set up Face ID or phone lock" send={sendSetupCodeAction} confirm={confirmSetupCodeAction} onTicket={setSetupTicket} />
        ))}

      <form action={cancelStepTwo} className="border-t border-line pt-6 text-center">
        <p className="mb-3 text-xs text-subtle">Not you, or no access to this phone?</p>
        <button type="submit" className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          Cancel and start again
        </button>
      </form>
      <p className="text-center text-xs text-subtle">Lost your phone? Use one of your other saved faces or devices, or reply to any of our emails and we’ll help you back in.</p>
    </div>
  );
}
