"use client";

import { useState, useTransition } from "react";
import { trackOrderAction } from "@/actions/tracking";
import type { TrackingView } from "@/server/courier/tracking";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { TrackingTimeline } from "./tracking-timeline";

/** Order number + email/phone lookup. Results render in place; nothing goes into the URL. */
export function TrackForm({ defaultNumber = "" }: { defaultNumber?: string }) {
  const [number, setNumber] = useState(defaultNumber);
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TrackingView | null>(null);
  const [pending, start] = useTransition();

  if (view) {
    return (
      <div className="space-y-10 text-left">
        <TrackingTimeline view={view} />
        <button type="button" onClick={() => setView(null)} className="link-draw eyebrow">
          Track another order
        </button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto max-w-md space-y-8 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await trackOrderAction({ number, contact });
          if (r.ok) setView(r.view);
          else setError(r.error);
        });
      }}
    >
      <Field label="Order number">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="MO-26123456" autoComplete="off" required maxLength={40} className="font-mono uppercase" />
      </Field>
      <Field label="Email or phone used for the order">
        <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com or 98…" autoComplete="email" required maxLength={120} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-ember">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending || !number.trim() || !contact.trim()}>
        {pending ? "Finding your parcel…" : "Track"}
      </Button>
    </form>
  );
}
