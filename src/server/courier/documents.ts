import { brand } from "@/config/brand";
import { PdfDoc } from "./pdf";

/*
 * Locally rendered courier documents (Test mode, or when the courier's own PDF isn't available):
 * 4×6" thermal labels, one per page in one merged PDF, and an A4 pickup manifest.
 */

export type LabelData = {
  awb: string;
  courierName: string;
  orderNumber: string;
  orderDate: Date;
  to: { name: string; phone: string; line1: string; line2?: string; city: string; state: string; pincode: string };
  cod: boolean;
  /** Minor units */
  codAmount: number;
  weightGrams: number;
  pieces: number;
  pickupLocation: string;
  test: boolean;
};

const rupees = (minor: number) => `Rs. ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function renderLabels(labels: LabelData[]): Buffer {
  const pdf = new PdfDoc();
  const W = 288; // 4in
  const H = 432; // 6in
  for (const l of labels) {
    pdf.page(W, H);
    const m = 12;
    pdf.rect(m - 4, m - 4, W - 2 * (m - 4), H - 2 * (m - 4));
    // Header: courier + payment mode
    pdf.text(m, m + 14, l.courierName, 13, "B");
    pdf.rect(W - m - 92, m, 92, 22, { fill: 0 });
    pdf.text(W - m - 86, m + 15, l.cod ? `COD ${rupees(l.codAmount)}` : "PREPAID", l.cod ? 9 : 11, "B", 1);
    pdf.line(m - 4, m + 28, W - m + 4, m + 28);
    // AWB barcode
    pdf.barcode(m + 8, m + 36, l.awb, W - 2 * m - 16, 54);
    pdf.text(W / 2 - l.awb.length * 4.2, m + 104, l.awb, 13, "M");
    pdf.text(m, m + 104, "AWB", 7, "R", 0.4);
    pdf.line(m - 4, m + 112, W - m + 4, m + 112);
    // Ship to
    pdf.text(m, m + 126, "DELIVER TO", 7, "B", 0.35);
    pdf.text(m, m + 142, l.to.name, 12, "B");
    let y = pdf.para(m, m + 157, [l.to.line1, l.to.line2].filter(Boolean).join(", "), W - 2 * m, 9.5);
    pdf.text(m, y + 2, `${l.to.city}, ${l.to.state}`, 10, "R");
    pdf.text(m, y + 22, `PIN ${l.to.pincode}`, 16, "B");
    pdf.text(W - m - 120, y + 22, `Ph ${l.to.phone}`, 9, "R");
    y += 34;
    pdf.line(m - 4, y, W - m + 4, y);
    // Order details
    pdf.text(m, y + 14, `Order ${l.orderNumber}`, 10, "B");
    pdf.text(W - m - 96, y + 14, day(l.orderDate), 9);
    pdf.text(m, y + 28, `${l.pieces} piece${l.pieces === 1 ? "" : "s"} - ${(l.weightGrams / 1000).toFixed(2)} kg`, 9);
    pdf.barcode(m, y + 36, l.orderNumber, 150, 26);
    y += 72;
    pdf.line(m - 4, y, W - m + 4, y);
    // Return address
    pdf.text(m, y + 12, "IF UNDELIVERED, RETURN TO", 7, "B", 0.35);
    pdf.text(m, y + 25, `${brand.name} - ${l.pickupLocation || "Primary"}`, 9, "B");
    pdf.text(m, y + 37, brand.email, 8);
    if (l.test) {
      pdf.rect(m, H - m - 30, W - 2 * m, 22, { fill: 0.85 });
      pdf.text(m + 8, H - m - 15, "TEST MODE - NOT A REAL SHIPMENT", 10, "B");
    }
  }
  return pdf.toBuffer();
}

export type ManifestRow = { orderNumber: string; awb: string; courierName: string; pincode: string; cod: boolean; codAmount: number; weightGrams: number };

export function renderManifest(rows: ManifestRow[], opts: { pickupLocation: string; test: boolean; date?: Date }): Buffer {
  const pdf = new PdfDoc();
  const W = 595;
  const H = 842;
  const m = 40;
  const perPage = 30;
  const date = opts.date ?? new Date();
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const byCourier = new Map<string, number>();
  for (const r of rows) byCourier.set(r.courierName, (byCourier.get(r.courierName) ?? 0) + 1);
  for (let p = 0; p < pages; p++) {
    pdf.page(W, H);
    pdf.text(m, m + 10, `${brand.name} - Pickup manifest`, 16, "B");
    pdf.text(m, m + 28, `${day(date)} - ${opts.pickupLocation || "Primary"} - ${rows.length} parcel${rows.length === 1 ? "" : "s"}${opts.test ? " - TEST MODE" : ""}`, 9, "R", 0.3);
    pdf.text(W - m - 60, m + 10, `Page ${p + 1}/${pages}`, 8, "R", 0.4);
    const cols = [m, m + 26, m + 120, m + 250, m + 370, m + 420, m + 470];
    let y = m + 56;
    ["#", "Order", "AWB", "Courier", "PIN", "Wt kg", "COD"].forEach((h, i) => pdf.text(cols[i], y, h, 8, "B"));
    pdf.line(m, y + 5, W - m, y + 5, 1);
    y += 20;
    rows.slice(p * perPage, (p + 1) * perPage).forEach((r, i) => {
      const idx = p * perPage + i + 1;
      pdf.text(cols[0], y, String(idx), 8);
      pdf.text(cols[1], y, r.orderNumber, 8);
      pdf.text(cols[2], y, r.awb, 8, "M");
      pdf.text(cols[3], y, r.courierName.slice(0, 22), 8);
      pdf.text(cols[4], y, r.pincode, 8);
      pdf.text(cols[5], y, (r.weightGrams / 1000).toFixed(2), 8);
      pdf.text(cols[6], y, r.cod ? rupees(r.codAmount) : "Prepaid", 8);
      pdf.line(m, y + 6, W - m, y + 6, 0.3);
      y += 21;
    });
    if (p === pages - 1) {
      y += 16;
      pdf.text(m, y, `By courier: ${[...byCourier].map(([c, k]) => `${c} ${k}`).join(", ")}`, 9);
      pdf.text(m, y + 14, `COD to collect: ${rupees(rows.filter((r) => r.cod).reduce((s, r) => s + r.codAmount, 0))}`, 9);
      pdf.line(m, H - m - 40, m + 200, H - m - 40);
      pdf.text(m, H - m - 28, "Handed over by (name, signature)", 8, "R", 0.4);
      pdf.line(W - m - 200, H - m - 40, W - m, H - m - 40);
      pdf.text(W - m - 200, H - m - 28, "Courier executive (name, signature, time)", 8, "R", 0.4);
    }
  }
  return pdf.toBuffer();
}
