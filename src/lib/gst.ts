// Pure GST helpers (India): state codes, GSTIN validation, financial years, document numbers, tax splits,
// GSTR-1 buckets. Client-safe (no server imports). Money is integer paise.

export const GST_STATES: { code: string; name: string; alias: string[] }[] = [
  { code: "01", name: "Jammu and Kashmir", alias: ["JK", "J&K", "JAMMU & KASHMIR"] },
  { code: "02", name: "Himachal Pradesh", alias: ["HP"] },
  { code: "03", name: "Punjab", alias: ["PB"] },
  { code: "04", name: "Chandigarh", alias: ["CH"] },
  { code: "05", name: "Uttarakhand", alias: ["UK", "UT", "UTTARANCHAL"] },
  { code: "06", name: "Haryana", alias: ["HR"] },
  { code: "07", name: "Delhi", alias: ["DL", "NEW DELHI", "NCT OF DELHI"] },
  { code: "08", name: "Rajasthan", alias: ["RJ"] },
  { code: "09", name: "Uttar Pradesh", alias: ["UP"] },
  { code: "10", name: "Bihar", alias: ["BR"] },
  { code: "11", name: "Sikkim", alias: ["SK"] },
  { code: "12", name: "Arunachal Pradesh", alias: ["AR"] },
  { code: "13", name: "Nagaland", alias: ["NL"] },
  { code: "14", name: "Manipur", alias: ["MN"] },
  { code: "15", name: "Mizoram", alias: ["MZ"] },
  { code: "16", name: "Tripura", alias: ["TR"] },
  { code: "17", name: "Meghalaya", alias: ["ML"] },
  { code: "18", name: "Assam", alias: ["AS"] },
  { code: "19", name: "West Bengal", alias: ["WB"] },
  { code: "20", name: "Jharkhand", alias: ["JH"] },
  { code: "21", name: "Odisha", alias: ["OR", "OD", "ORISSA"] },
  { code: "22", name: "Chhattisgarh", alias: ["CG", "CT"] },
  { code: "23", name: "Madhya Pradesh", alias: ["MP"] },
  { code: "24", name: "Gujarat", alias: ["GJ"] },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", alias: ["DN", "DD", "DNHDD", "DAMAN AND DIU", "DADRA AND NAGAR HAVELI"] },
  { code: "27", name: "Maharashtra", alias: ["MH"] },
  { code: "29", name: "Karnataka", alias: ["KA"] },
  { code: "30", name: "Goa", alias: ["GA"] },
  { code: "31", name: "Lakshadweep", alias: ["LD"] },
  { code: "32", name: "Kerala", alias: ["KL"] },
  { code: "33", name: "Tamil Nadu", alias: ["TN"] },
  { code: "34", name: "Puducherry", alias: ["PY", "PONDICHERRY"] },
  { code: "35", name: "Andaman and Nicobar Islands", alias: ["AN", "ANDAMAN & NICOBAR"] },
  { code: "36", name: "Telangana", alias: ["TG", "TS"] },
  { code: "37", name: "Andhra Pradesh", alias: ["AP"] },
  { code: "38", name: "Ladakh", alias: ["LA"] },
  { code: "97", name: "Other Territory", alias: [] },
];

/** Place of supply for exports (outside India). */
export const FOREIGN_POS = "96";

const norm = (s: string) => s.toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]/g, "");

/** GST state code for a state name, abbreviation or code; null when unknown. */
export function stateCodeFor(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim();
  if (/^\d{1,2}$/.test(s)) {
    const c = s.padStart(2, "0");
    return GST_STATES.some((x) => x.code === c) ? c : null;
  }
  const n = norm(s);
  const hit = GST_STATES.find((x) => norm(x.name) === n || x.alias.some((a) => norm(a) === n));
  return hit?.code ?? null;
}

export const stateName = (code: string | null | undefined) => (code === FOREIGN_POS ? "Outside India" : (GST_STATES.find((s) => s.code === code)?.name ?? "—"));

// ─────────────────────────────── GSTIN ───────────────────────────────

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Check character of the first 14 characters (GSTN mod-36 algorithm). */
export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(v: string | null | undefined) {
  return (v ?? "").toUpperCase().replace(/\s+/g, "");
}

/** Structurally valid GSTIN with a correct check digit and a known state code. */
export function isValidGstin(v: string | null | undefined) {
  const g = normalizeGstin(v);
  return GSTIN_RE.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14] && GST_STATES.some((s) => s.code === g.slice(0, 2));
}

// ─────────────────────────────── Financial year & numbers ───────────────────────────────

/** Calendar parts in India time (financial years and invoice dates follow IST). */
export function istParts(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate() };
}

/** "2026-27" for any date from 1 Apr 2026 to 31 Mar 2027 (IST). */
export function financialYear(d: Date) {
  const { y, m } = istParts(d);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First instant of a financial year label (IST midnight 1 April). */
export function fyStart(fy: string) {
  const y = Number(fy.slice(0, 4));
  return new Date(Date.UTC(y, 3, 1) - 330 * 60_000);
}

/** GSTR-1 return period "MMYYYY" (IST). */
export const returnPeriod = (d: Date) => {
  const { y, m } = istParts(d);
  return `${String(m).padStart(2, "0")}${y}`;
};

/** dd/mm/yyyy (IST) — the e-invoice and GSTR-1 date format. */
export function gstDate(d: Date) {
  const { y, m, d: day } = istParts(d);
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Digits in the running number. 5 keeps "MO/2026-27/00123" at 16 characters — the GST (Rule 46) and IRP limit. */
export const SEQ_DIGITS = 5;

export function formatDocNumber(prefix: string, fy: string, seq: number) {
  return `${prefix}/${fy}/${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/** IRP document numbers: 1–16 chars, first char A–Z or 1–9, then A–Z 0–9 / -. */
export const validDocNumber = (n: string) => /^[A-Z1-9][A-Z0-9/-]{0,15}$/.test(n);

// ─────────────────────────────── Tax maths ───────────────────────────────

/** Splits integer `total` across `weights` proportionally; the rounding remainder goes to the largest fractions. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k].i]++;
  return out;
}

/** CGST + SGST halves (CGST takes the odd paisa) for intra-state; IGST for inter-state. */
export function splitTax(tax: number, interState: boolean) {
  if (interState) return { cgst: 0, sgst: 0, igst: tax };
  const sgst = Math.floor(tax / 2);
  return { cgst: tax - sgst, sgst, igst: 0 };
}

// ─────────────────────────────── GSTR-1 ───────────────────────────────

/** B2C (Large): inter-state supplies to unregistered buyers above ₹1,00,000 per invoice (since Aug 2024). */
export const B2CL_THRESHOLD = 100_000_00;

export type Gstr1Bucket = "B2B" | "B2CL" | "B2CS" | "EXPORT";

export function gstr1Bucket(doc: { b2b: boolean; interState: boolean; total: number; placeOfSupply: string }): Gstr1Bucket {
  if (doc.b2b) return "B2B";
  if (doc.placeOfSupply === FOREIGN_POS) return "EXPORT";
  if (doc.interState && doc.total > B2CL_THRESHOLD) return "B2CL";
  return "B2CS";
}

/** Credit notes: registered → CDNR; unregistered large inter-state → CDNUR; others reduce B2CS. */
export function creditNoteBucket(doc: { b2b: boolean; interState: boolean; placeOfSupply: string }, invoiceTotal: number): "CDNR" | "CDNUR" | "B2CS" {
  if (doc.b2b) return "CDNR";
  if (doc.placeOfSupply === FOREIGN_POS || (doc.interState && invoiceTotal > B2CL_THRESHOLD)) return "CDNUR";
  return "B2CS";
}

/** Suggested HSN codes for the store's ranges. */
export const HSN_SUGGESTIONS: { code: string; label: string }[] = [
  { code: "33074100", label: "Agarbatti & odoriferous preparations that operate by burning" },
  { code: "33074900", label: "Room perfumes / other preparations for perfuming rooms" },
  { code: "33030010", label: "Perfumes (attars, extraits)" },
  { code: "33030090", label: "Perfumes & toilet waters, other" },
  { code: "33012990", label: "Essential oils, other" },
  { code: "34060010", label: "Candles" },
  { code: "44219990", label: "Wooden articles (oud chips, burners)" },
  { code: "48191010", label: "Gift boxes (cartons)" },
];

export const validHsn = (v: string) => /^\d{4}(\d{2}(\d{2})?)?$/.test(v);
