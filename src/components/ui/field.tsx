import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full border-0 border-b border-line-strong bg-transparent px-0 py-3 text-sm text-fg placeholder:text-subtle transition-colors duration-500 focus:border-gold focus:outline-none aria-[invalid=true]:border-ember";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "cursor-pointer appearance-none bg-[length:10px] bg-[right_center] bg-no-repeat pe-6", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="eyebrow !text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-ember">{error}</span> : hint ? <span className="mt-1 block text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

export function Badge({ className, tone = "gold", ...props }: ComponentProps<"span"> & { tone?: "gold" | "ember" | "muted" }) {
  const tones = { gold: "border-gold/40 text-gold", ember: "border-ember/40 text-ember", muted: "border-line-strong text-muted" };
  return <span className={cn("inline-flex items-center border px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.2em]", tones[tone], className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}
