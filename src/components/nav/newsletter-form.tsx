"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { subscribeNewsletter } from "@/actions/engagement";

export function NewsletterForm({ placeholder, cta }: { placeholder: string; cta: string }) {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-8 flex items-center border-b border-line-strong focus-within:border-gold"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await subscribeNewsletter(email);
          if (res.ok) {
            toast(res.message);
            setEmail("");
          } else toast.error(res.error);
        });
      }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-12 flex-1 bg-transparent text-sm placeholder:text-subtle focus:outline-none"
      />
      <button disabled={pending} className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.28em] text-gold disabled:opacity-50">
        {cta} <ArrowRight className="size-3.5 rtl:rotate-180" />
      </button>
    </form>
  );
}
