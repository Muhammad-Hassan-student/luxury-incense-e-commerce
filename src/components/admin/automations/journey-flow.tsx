import { Clock, Flag, GitBranch, Mail, Sparkles, Ticket, Zap, type LucideIcon } from "lucide-react";
import { fmtWait, JOURNEYS, TEMPLATE_LABEL, type JourneyKey, type JourneyStep, type StepCondition } from "@/lib/journeys";
import { SEGMENT_HINT } from "@/lib/segments";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Node = { kind: "trigger" | "wait" | "condition" | "action" | "exit"; title: string; detail?: string; icon: LucideIcon };

const KIND_LABEL: Record<Node["kind"], string> = { trigger: "Trigger", wait: "Wait", condition: "Check", action: "Action", exit: "Exit" };

function conditionText(c: StepCondition): { title: string; detail: string } {
  switch (c.kind) {
    case "still-in":
      return { title: `Still ${c.segments.join(" or ")}?`, detail: "Otherwise the run exits (left segment)." };
    case "has-unreviewed":
      return {
        title: "Any pieces not yet reviewed?",
        detail: c.otherwise === "skip" ? "If everything is reviewed, this step is skipped." : "If everything is reviewed, the run ends.",
      };
    case "coupon-unused":
      return { title: "Code still unused and valid?", detail: "If it was used or has lapsed, no reminder." };
  }
}

/** Vertical trigger → wait → check → action flow for one journey. */
export function JourneyFlow({ journeyKey, steps, frequencyCapHours, attributionDays }: { journeyKey: JourneyKey; steps: JourneyStep[]; frequencyCapHours: number; attributionDays: number }) {
  const meta = JOURNEYS[journeyKey];
  const nodes: (Node & { step?: number })[] = [
    {
      kind: "trigger",
      icon: Zap,
      title: meta.segment ? `Enters “${meta.segment}”` : "Order delivered",
      detail: meta.segment ? SEGMENT_HINT[meta.segment] : "Signed-in customer, retail order, at least one piece not yet reviewed.",
    },
  ];
  steps.forEach((s, i) => {
    nodes.push({ kind: "wait", icon: Clock, title: i === 0 && s.waitHours === 0 ? "Right away" : fmtWait(s.waitHours), step: i });
    nodes.push({
      kind: "condition",
      icon: GitBranch,
      title: meta.exitOnOrder ? "Opted in · no order since entering?" : "Still opted in and mailable?",
      detail: i === 0 ? `Staff, deleted accounts and opted-out customers exit. Max 1 journey email per ${frequencyCapHours}h — otherwise the step waits.` : undefined,
      step: i,
    });
    for (const c of s.conditions) nodes.push({ kind: "condition", icon: GitBranch, ...conditionText(c), step: i });
    for (const a of s.actions) {
      if (a.kind === "email") nodes.push({ kind: "action", icon: Mail, title: `Email · ${TEMPLATE_LABEL[a.template].split(" · ")[1]}`, step: i });
      if (a.kind === "coupon")
        nodes.push({
          kind: "action",
          icon: Ticket,
          title: `Personal ${a.percentOff}% code`,
          detail: `Single use, bound to their email, expires after ${a.validDays} days${a.minSubtotal ? ` · min. bag ${formatMoney(a.minSubtotal)}` : ""}.`,
          step: i,
        });
      if (a.kind === "points") nodes.push({ kind: "action", icon: Sparkles, title: `+${a.amount} bonus points`, detail: "One ledger entry per run, never repeated.", step: i });
    }
  });
  nodes.push({
    kind: "exit",
    icon: Flag,
    title: meta.exitOnOrder ? "Exit — any order ends the run as converted" : "Exit — run completes",
    detail: `Orders within ${attributionDays} days of an email are attributed to the last email sent.`,
  });

  return (
    <ol className="relative px-5 py-6" aria-label={`${meta.name} flow`}>
      {nodes.map((n, i) => {
        const Icon = n.icon;
        const firstOfStep = n.kind === "wait" && n.step !== undefined;
        return (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            {i < nodes.length - 1 ? <span aria-hidden className="absolute start-[1.1875rem] top-10 bottom-0 w-px bg-line-strong" /> : null}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] flex size-10 shrink-0 items-center justify-center border",
                n.kind === "trigger" && "border-gold bg-gold text-bg",
                n.kind === "wait" && "rounded-full border-line-strong bg-bg text-muted",
                n.kind === "condition" && "rotate-45 border-gold/50 bg-bg text-gold [&>svg]:-rotate-45",
                n.kind === "action" && "border-gold/60 bg-gold/10 text-gold",
                n.kind === "exit" && "border-line-strong bg-bg-soft text-muted",
              )}
            >
              <Icon className="size-4" strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
                {KIND_LABEL[n.kind]}
                {firstOfStep ? <span className="ms-2 text-gold">Step {n.step! + 1}</span> : null}
              </p>
              <p className={cn("mt-1 text-sm", n.kind === "trigger" || n.kind === "action" ? "text-fg" : "text-muted")}>{n.title}</p>
              {n.detail ? <p className="mt-0.5 text-xs text-subtle">{n.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
