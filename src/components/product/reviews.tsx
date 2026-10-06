"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { submitReview } from "@/actions/engagement";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Review = { id: string; rating: number; title: string; body: string; verified: boolean; author: string; date: string };

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex gap-0.5 text-gold", className)} aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= Math.round(value) ? "" : "opacity-25"}>
          ★
        </span>
      ))}
    </span>
  );
}

export function Reviews({ productId, reviews, avg, count, signedIn }: { productId: string; reviews: Review[]; avg: number; count: number; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  return (
    <section className="grid gap-16 lg:grid-cols-[1fr_2fr]">
      <div>
        <p className="eyebrow mb-4">Reviews</p>
        <p className="display text-8xl">{count ? avg.toFixed(1) : "—"}</p>
        <Stars value={avg} className="mt-3 text-lg" />
        <p className="mt-2 text-sm text-muted">{count ? `${count} review${count > 1 ? "s" : ""}` : "No reviews yet"}</p>
        {signedIn ? (
          <Button variant="outline" className="mt-8" onClick={() => setOpen((o) => !o)}>
            Write a review
          </Button>
        ) : (
          <Link href="/signin" className="link-draw eyebrow mt-8 inline-block">
            Sign in to review
          </Link>
        )}
      </div>
      <div>
        {open && (
          <form
            className="mb-16 grid gap-6 border border-line p-8"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await submitReview({ productId, rating, title, body });
                if (res.ok) {
                  toast(res.message);
                  setOpen(false);
                  setTitle("");
                  setBody("");
                } else toast.error(res.error);
              });
            }}
          >
            <fieldset>
              <legend className="eyebrow mb-3 !text-muted">Your rating</legend>
              <div className="flex gap-1 text-2xl">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button type="button" key={i} onClick={() => setRating(i)} aria-label={`${i} stars`} className={i <= rating ? "text-gold" : "text-subtle"}>
                    ★
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
            </Field>
            <Field label="Your review">
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} required minLength={10} maxLength={2000} />
            </Field>
            <Button type="submit" disabled={pending} className="justify-self-start">
              Submit review
            </Button>
          </form>
        )}
        <ul className="divide-y divide-line border-y border-line">
          {reviews.map((r) => (
            <li key={r.id} className="py-8">
              <div className="flex items-center justify-between">
                <Stars value={r.rating} />
                <span className="text-xs text-subtle">{r.date}</span>
              </div>
              <p className="mt-3 font-display text-2xl">{r.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{r.body}</p>
              <p className="mt-4 text-xs text-subtle">
                {r.author}
                {r.verified && <span className="ms-3 text-gold">Verified buyer</span>}
              </p>
            </li>
          ))}
          {reviews.length === 0 && <li className="py-12 text-center text-sm text-muted">Be the first to share your ritual.</li>}
        </ul>
      </div>
    </section>
  );
}
