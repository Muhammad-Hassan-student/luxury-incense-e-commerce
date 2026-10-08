"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJourneyEmailsByToken } from "@/actions/marketing";
import { Button } from "@/components/ui/button";

export function UnsubscribeForm({ token, allowed }: { token: string; allowed: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <div className="mt-10 flex flex-col items-center gap-4">
      <Button
        variant={allowed ? "primary" : "outline"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setJourneyEmailsByToken({ token, allowed: !allowed });
            setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "One moment…" : allowed ? "Unsubscribe" : "Subscribe again"}
      </Button>
      {message ? (
        <p role="status" className={message.ok ? "text-sm text-gold" : "text-sm text-ember"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
