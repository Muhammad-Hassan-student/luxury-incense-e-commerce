"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AddMethod, CodeStep, ProveMethod } from "@/components/security/steps";
import type { StepResult } from "@/components/security/client";
import { beginStepTwo, cancelStepTwo, confirmSetupCodeAction, sendSetupCodeAction, type StepTwoStart } from "../actions";

type Initial = "verify" | "setup" | "expired" | "none" | "done";

export function StepTwo({ initial, email, callbackUrl }: { initial: Initial; email: string | null; callbackUrl: string }) {
  const t = useTranslations("signin");
  const [start, setStart] = useState<StepTwoStart | null>(null);
  const [setupTicket, setSetupTicket] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(initial === "expired" || initial === "none" ? t("expired") : null);
  const [finished, setFinished] = useState(initial === "done");

  const load = useCallback(() => {
    beginStepTwo()
      .then((s) => {
        setStart(s);
        if (s.state === "expired" || s.state === "none") setExpired(t("expired"));
        if (s.state === "done") setFinished(true);
      })
      .catch(() => setExpired(t("tooManyRequests")));
  }, [t]);

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

  if (finished) return <p className="text-muted">{t("signingIn")}</p>;

  if (expired) {
    return (
      <div className="space-y-6 border border-line p-6">
        <p className="text-sm text-muted">{t("expiredTryAgain", { message: expired })}</p>
        <form action={cancelStepTwo}>
          <Button type="submit" className="w-full">{t("requestNewLink")}</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!start && <p className="text-sm text-muted">{t("gettingReady")}</p>}
      {start?.state === "unavailable" && (
        <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
          {t("unavailable")}
        </p>
      )}

      {start?.state === "verify" &&
        (start.lockedMinutes ? (
          <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
            {t("lockedMinutes", { count: start.lockedMinutes })}
          </p>
        ) : (
          <ProveMethod ticket={start.ticket} methods={start.methods} onDone={onDone} onExpired={onExpired} />
        ))}

      {start?.state === "setup" &&
        (setupTicket ? (
          <AddMethod ticket={setupTicket} onDone={onDone} onExpired={onExpired} />
        ) : (
          <CodeStep email={email ?? undefined} purpose="setup" send={sendSetupCodeAction} confirm={confirmSetupCodeAction} onTicket={setSetupTicket} />
        ))}

      <form action={cancelStepTwo} className="border-t border-line pt-6 text-center">
        <p className="mb-3 text-xs text-subtle">{t("notYou")}</p>
        <button type="submit" className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
          {t("cancelRestart")}
        </button>
      </form>
      <p className="text-center text-xs text-subtle">{t("lostPhone")}</p>
    </div>
  );
}
