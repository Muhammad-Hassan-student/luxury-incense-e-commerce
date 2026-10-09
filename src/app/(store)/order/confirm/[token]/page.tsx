import type { Metadata } from "next";
import Link from "next/link";
import { peekCodLink } from "@/server/cod";
import { formatMoney } from "@/lib/money";
import { CodConfirmForm } from "@/components/order/cod-confirm-form";

// The token is a credential: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: "Confirm your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const fmt = (d: Date) => d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function ConfirmCodPage(props: PageProps<"/order/confirm/[token]">) {
  const { token } = await props.params;
  // Viewing never confirms anything (WhatsApp/email link previews open this page too).
  const s = await peekCodLink(decodeURIComponent(token));

  return (
    <section className="mx-auto max-w-xl px-6 pt-40 pb-32 text-center">
      <p className="eyebrow mb-4">Cash on delivery</p>
      {s.state === "awaiting" ? (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{s.name ? `${s.name}, confirm your order` : "Confirm your order"}</h1>
          <p className="mt-6 text-sm text-muted">
            Order <span className="text-fg">{s.number}</span>
            {s.city ? ` to ${s.city}` : ""} · <span className="text-fg">{formatMoney(s.payable)}</span> payable on delivery.
            {s.confirmBy ? ` Please confirm by ${fmt(s.confirmBy)}, or it will be released.` : ""}
          </p>
          <ul className="mx-auto mt-8 max-w-sm divide-y divide-line border-y border-line text-start text-sm">
            {s.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-4 py-3">
                <span>
                  {i.name} <span className="text-subtle">{i.label}</span>
                </span>
                <span className="text-muted">× {i.quantity}</span>
              </li>
            ))}
          </ul>
          <CodConfirmForm token={decodeURIComponent(token)} />
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">
            {s.state === "confirmed" ? "Order confirmed" : s.state === "cancelled" ? "Order cancelled" : s.state === "expired" ? "This link has expired" : "This link isn’t valid"}
          </h1>
          <p className="mt-6 text-sm text-muted">
            {s.state === "confirmed"
              ? `Thank you — order ${s.number} is confirmed. We’ll write when it ships.`
              : s.state === "cancelled"
                ? `Order ${s.number} was cancelled. Nothing is due.`
                : s.state === "expired"
                  ? `Order ${s.number} wasn’t confirmed in time. If you still want it, you’re welcome to order again.`
                  : "Use the link from your WhatsApp message or email, or contact us for help."}
          </p>
          <Link href="/shop" className="link-draw mt-10 inline-block text-sm text-gold">
            Continue to the boutique
          </Link>
        </>
      )}
    </section>
  );
}
