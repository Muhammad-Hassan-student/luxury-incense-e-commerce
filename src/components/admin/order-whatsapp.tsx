import type { CodStatus, OrderStatus, WhatsAppStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { fmtDateTime } from "@/lib/admin-shared";
import { Section } from "./ui";
import { CodCallOutcome, WhatsAppResend } from "./order-whatsapp-actions";

type Msg = { id: string; direction: string; kind: string; template: string | null; body: string | null; status: WhatsAppStatus; error: string | null; test: boolean; phone: string; createdAt: Date };
type Reason = { code: string; label: string; points: number };
type Notice = Parameters<typeof WhatsAppResend>[0]["notices"][number];

const KIND: Record<string, string> = {
  order_confirmed: "Order confirmed",
  cod_confirm: "COD confirmation request",
  cod_reminder: "COD reminder",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  text: "Reply",
  inbound: "Customer",
};

const statusTone = (s: WhatsAppStatus) => (s === "FAILED" ? "ember" : s === "READ" || s === "DELIVERED" ? "gold" : "muted");
const riskTone = (n: number) => (n >= 60 ? "ember" : n >= 30 ? "gold" : "muted");
const mask = (p: string) => (p.length > 7 ? `${p.slice(0, p.length - 8)}•••••${p.slice(-3)}` : p);

/** COD verification, RTO risk and the WhatsApp timeline for one order. */
export function OrderWhatsAppPanel(props: {
  orderId: string;
  status: OrderStatus;
  codStatus: CodStatus | null;
  codConfirmBy: Date | null;
  codConfirmedAt: Date | null;
  codConfirmedVia: string | null;
  riskScore: number | null;
  riskReasons: unknown;
  whatsappOptIn: boolean;
  messages: Msg[];
  resendable: Notice[];
  canFulfil: boolean;
  canCancel: boolean;
}) {
  const reasons = Array.isArray(props.riskReasons) ? (props.riskReasons as Reason[]) : [];
  const awaiting = props.codStatus === "AWAITING" && props.status === "PENDING";
  return (
    <>
      {props.codStatus || props.riskScore != null ? (
        <Section title="COD & risk" actions={props.riskScore != null ? <Badge tone={riskTone(props.riskScore)}>Risk {props.riskScore}</Badge> : null}>
          <div className="space-y-4 px-5 py-4 text-sm">
            {props.codStatus ? (
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Cash on delivery</span>
                  <Badge tone={props.codStatus === "AWAITING" ? "ember" : props.codStatus === "CONFIRMED" ? "gold" : "muted"} data-cod-status={props.codStatus}>
                    {props.codStatus === "AWAITING" ? "Awaiting confirmation" : props.codStatus.toLowerCase()}
                  </Badge>
                </p>
                {awaiting ? <p className="text-xs text-subtle">Don’t pack yet. Auto-cancels {fmtDateTime(props.codConfirmBy)} if not confirmed.</p> : null}
                {props.codConfirmedAt ? (
                  <p className="text-xs text-subtle">
                    Confirmed {fmtDateTime(props.codConfirmedAt)}
                    {props.codConfirmedVia ? ` · ${props.codConfirmedVia}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            {reasons.length ? (
              <ul className="space-y-1">
                {reasons.map((r) => (
                  <li key={r.code} className="flex justify-between gap-3 text-xs">
                    <span className="text-muted">{r.label}</span>
                    <span className="tabular-nums text-subtle">+{r.points}</span>
                  </li>
                ))}
              </ul>
            ) : props.riskScore != null ? (
              <p className="text-xs text-subtle">No risk signals.</p>
            ) : null}
            {awaiting && props.canFulfil ? (
              <div className="border-t border-line pt-4">
                <CodCallOutcome orderId={props.orderId} canCancel={props.canCancel} />
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={`WhatsApp · ${props.messages.length}`} actions={<Badge tone={props.whatsappOptIn ? "gold" : "muted"}>{props.whatsappOptIn ? "Opted in" : "Not opted in"}</Badge>}>
        {props.messages.length ? (
          <ol className="divide-y divide-line">
            {props.messages.map((m) => (
              <li key={m.id} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={m.direction === "in" ? "text-gold" : "text-fg"}>
                    {m.direction === "in" ? "← " : "→ "}
                    {KIND[m.kind] ?? m.kind}
                  </span>
                  <span className="flex items-center gap-2">
                    {m.test ? <Badge tone="muted">Test mode</Badge> : null}
                    <Badge tone={statusTone(m.status)}>{m.status.toLowerCase()}</Badge>
                  </span>
                </div>
                {m.body ? <p className="text-xs text-muted">{m.body}</p> : m.template ? <p className="font-mono text-xs text-subtle">{m.template}</p> : null}
                {m.error ? <p className="text-xs text-ember">{m.error}</p> : null}
                <p className="text-xs text-subtle">
                  {fmtDateTime(m.createdAt)} · {mask(m.phone)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">{props.whatsappOptIn ? "No messages yet." : "The customer didn’t ask for WhatsApp updates."}</p>
        )}
        {props.canFulfil && props.whatsappOptIn && props.resendable.length ? (
          <div className="border-t border-line px-5 py-4">
            <WhatsAppResend orderId={props.orderId} notices={props.resendable} />
          </div>
        ) : null}
      </Section>
    </>
  );
}
