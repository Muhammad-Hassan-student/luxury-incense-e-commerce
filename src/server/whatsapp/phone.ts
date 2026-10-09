// Phone normalisation to E.164. Pure (no server imports) so checkout, tests and admin can share it.

const CALLING_CODES: Record<string, string> = {
  IN: "91", AE: "971", SA: "966", QA: "974", OM: "968", KW: "965", BH: "973", PK: "92",
  GB: "44", US: "1", CA: "1", AU: "61", SG: "65", FR: "33", DE: "49",
};

/**
 * Returns `+<country code><number>` or null when the input can't be a real mobile number.
 * Default country is India: 10-digit numbers starting 6–9, optionally prefixed 0 / 91 / +91.
 */
export function normalizePhone(input: string | null | undefined, country = "IN"): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw || raw.length > 32) return null;
  if (/[^\d\s()+.\-]/.test(raw)) return null;
  const plus = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);

  const cc = CALLING_CODES[country.toUpperCase()] ?? "91";
  if (!plus) {
    if (cc === "91") {
      if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      if (digits.length !== 10) return null;
      digits = `91${digits}`;
    } else {
      digits = digits.replace(/^0+/, "");
      if (!digits.startsWith(cc) || digits.length < cc.length + 6) digits = `${cc}${digits}`;
    }
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  // Indian mobiles: 10 digits starting 6–9.
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

/** Obviously fake numbers (all one digit, 1234567890-style runs) — an RTO risk signal. */
export function looksFakePhone(e164: string) {
  const local = e164.startsWith("+91") ? e164.slice(3) : e164.replace(/^\+\d{1,3}/, "");
  if (/^(\d)\1+$/.test(local)) return true;
  if ("01234567890123456789".includes(local) || "98765432109876543210".includes(local)) return true;
  // Six or more of the same digit in a row.
  return /(\d)\1{5,}/.test(local);
}

/** +91 98•••••210 — for UIs and logs. */
export const maskPhone = (e164: string) => (e164.length > 7 ? `${e164.slice(0, e164.length - 8)}${"•".repeat(5)}${e164.slice(-3)}` : "•••");

/** Graph API wants digits only. */
export const waId = (e164: string) => e164.replace(/^\+/, "");
