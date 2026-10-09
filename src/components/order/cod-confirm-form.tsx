"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerCodLinkAction } from "@/actions/cod";
import { Button } from "@/components/ui/button";

export function CodConfirmForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const answer = (decision: "confirm" | "cancel") =>
    start(async () => {
      const r = await answerCodLinkAction({ token, decision });
      setMessage({ ok: r.ok, text: r.text });
      if (r.ok) router.refresh();
    });

  return (
    <div className="mt-10 flex flex-col items-center gap-4">
      {asking ? (
        <div className="flex flex-col items-center gap-3" role="alertdialog" aria-label="Cancel this order?">
          <p className="text-sm text-muted">Cancel this order? Your pieces go back on the shelf.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="danger" disabled={pending} onClick={() => answer("cancel")}>
              {pending ? "One moment…" : "Yes, cancel it"}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
              Keep my order
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button disabled={pending} onClick={() => answer("confirm")}>
            {pending ? "Confirming…" : "Confirm my order"}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setAsking(true)}>
            Cancel order
          </Button>
        </div>
      )}
      {message ? (
        <p role="status" className={message.ok ? "text-sm text-gold" : "text-sm text-ember"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
