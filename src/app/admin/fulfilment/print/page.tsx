import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { PrintButton } from "@/components/account/print-button";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { packingData } from "@/server/courier/fulfilment";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print", robots: { index: false } };

// Plain paper styling; in print only the document is shown (same approach as the tax invoice).
const css = `
.mo-doc { background:#fff; color:#111; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size:12.5px; line-height:1.45; }
.mo-doc h1, .mo-doc h2 { font-family: Georgia, "Times New Roman", serif; font-weight:400; color:#111; margin:0; }
.mo-doc .muted { color:#555; }
.mo-doc table { width:100%; border-collapse:collapse; }
.mo-doc th { text-align:left; font-weight:600; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; border-bottom:1.5px solid #111; padding:7px 6px; }
.mo-doc td { border-bottom:1px solid #ddd; padding:7px 6px; vertical-align:top; }
.mo-doc .num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
.mo-doc .box { display:inline-block; width:14px; height:14px; border:1.5px solid #111; vertical-align:middle; }
.mo-doc .slip { padding:28px; border:1px solid #ddd; margin-bottom:24px; }
.mo-doc .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background:#fff !important; color:#000 !important; }
  body::before, body::after { display:none !important; }
  body *:not(:has(.mo-doc)):not(.mo-doc):not(.mo-doc *) { display:none !important; }
  :has(> .mo-doc), :has(.mo-doc) { background:#fff !important; padding:0 !important; margin:0 !important; border:0 !important; max-width:none !important; min-height:0 !important; display:block !important; }
  .mo-doc { padding:0 !important; }
  .mo-noprint { display:none !important; }
  .mo-doc .slip { border:0; padding:0; margin:0; break-after: page; }
  .mo-doc .slip:last-child { break-after: auto; }
  .mo-doc tr { break-inside: avoid; }
}
`;

const ids = (v: string | string[] | undefined) =>
  [...new Set((Array.isArray(v) ? v.join(",") : (v ?? "")).split(",").map((s) => s.trim()).filter((s) => s && s.length <= 64))].slice(0, 200);

export default async function FulfilmentPrintPage(props: PageProps<"/admin/fulfilment/print">) {
  const user = await requirePermission("orders.fulfil");
  const sp = await props.searchParams;
  const doc = sp.doc === "slips" ? "slips" : "picklist";
  const orderIds = ids(sp.orders);
  const { orders, pickList } = await packingData(orderIds);
  if (orders.length) await audit(user.id, `fulfilment.print_${doc}`, "Order", orders.length === 1 ? orders[0].id : null, { count: orders.length });
  const printed = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const units = pickList.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <style>{css}</style>
      <div className="mo-noprint mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href="/admin/fulfilment" className="link-draw eyebrow">
          Back to the board
        </Link>
        <div className="flex items-center gap-3">
          <Link href={`/admin/fulfilment/print?doc=${doc === "slips" ? "picklist" : "slips"}&orders=${orderIds.join(",")}`} className="text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
            {doc === "slips" ? "Pick list" : "Packing slips"}
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="mo-doc border border-line p-6 sm:p-10">
        {!orders.length ? (
          <p>No orders selected.</p>
        ) : doc === "picklist" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
              <div>
                <h1 style={{ fontSize: 26 }}>Pick list</h1>
                <p className="muted">
                  {orders.length} order{orders.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"} · {pickList.length} SKU{pickList.length === 1 ? "" : "s"}
                </p>
              </div>
              <p className="muted" style={{ textAlign: "right" }}>
                {brand.name}
                <br />
                Printed {printed}
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>SKU</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>For orders</th>
                </tr>
              </thead>
              <tbody>
                {pickList.map((r) => (
                  <tr key={r.sku}>
                    <td>
                      <span className="box" />
                    </td>
                    <td className="mono">{r.sku}</td>
                    <td>
                      {r.name} <span className="muted">{r.label}</span>
                      {r.inCoffret ? <span className="muted"> · coffret piece</span> : null}
                    </td>
                    <td className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                      {r.quantity}
                    </td>
                    <td className="mono muted" style={{ fontSize: 11 }}>
                      {r.orders.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 14 }}>
              Gift cards are delivered by email and are not listed. Coffrets are picked as their pieces.
            </p>
          </>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="slip">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
                <div>
                  <h2 style={{ fontSize: 24 }}>{brand.name}</h2>
                  <p className="muted">{brand.tagline}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase" }}>Packing slip</p>
                  <p className="mono" style={{ fontSize: 16 }}>
                    {o.number}
                  </p>
                  <p className="muted">{o.placedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                  {o.awb ? (
                    <p className="mono muted">
                      {o.courierName} · {o.awb}
                    </p>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 32, margin: "20px 0" }}>
                <div>
                  <p style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Ship to</p>
                  <p>{o.address.fullName}</p>
                  <p className="muted">
                    {[o.address.line1, o.address.line2].filter(Boolean).join(", ")}
                    <br />
                    {o.address.city}, {o.address.state} {o.address.postalCode}
                    <br />
                    {o.address.phone}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Payment</p>
                  <p>{o.codDue ? `Cash on delivery — collect ${formatMoney(o.codDue)}` : "Prepaid — nothing to collect"}</p>
                  {o.deliveryDate ? <p className="muted">Requested by {o.deliveryDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p> : null}
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Item</th>
                    <th>SKU</th>
                    <th className="num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items
                    .filter((i) => !i.digital)
                    .map((i) => (
                      <tr key={i.sku + i.label}>
                        <td>
                          <span className="box" />
                        </td>
                        <td>
                          {i.name} <span className="muted">{i.label}</span>
                          {i.components?.length ? <div className="muted">Includes: {i.components.map((c) => `${c.name} ${c.label}`).join(", ")}</div> : null}
                        </td>
                        <td className="mono">{i.sku}</td>
                        <td className="num">{i.quantity}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {o.giftWrap || o.giftNote ? (
                <div style={{ marginTop: 18, padding: 14, border: "1px dashed #999" }}>
                  <p style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>{o.giftWrap ? "Gift wrap" : "Gift note"}</p>
                  {o.giftNote ? <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15 }}>“{o.giftNote}”</p> : <p className="muted">No note.</p>}
                  <p className="muted">Gift order: no prices in the parcel.</p>
                </div>
              ) : null}
              {o.notes ? (
                <p className="muted" style={{ marginTop: 12 }}>
                  Note: {o.notes}
                </p>
              ) : null}
              <p className="muted" style={{ marginTop: 22 }}>
                Packed by ____________ · Checked by ____________ · Thank you for choosing {brand.name}. Questions? {brand.email}
              </p>
            </div>
          ))
        )}
      </div>
    </>
  );
}
