import { describe, expect, it } from "vitest";
import { CONFIRM_PATH, parseConfirmTarget, wrapMagicLink } from "./magic-link";

const ORIGIN = "https://shop.example.com";
const token = "a".repeat(64);
const callback = `${ORIGIN}/api/auth/callback/resend?callbackUrl=%2Faccount&token=${token}&email=Buyer%40Example.com`;

describe("magic links", () => {
  it("wraps the callback into the confirm page on the same origin and unwraps it again", () => {
    const wrapped = new URL(wrapMagicLink(callback));
    expect(wrapped.origin).toBe(ORIGIN);
    expect(wrapped.pathname).toBe(CONFIRM_PATH);
    const t = parseConfirmTarget(wrapped.searchParams.get("u"), ORIGIN);
    expect(t).toEqual({ href: new URL(callback).toString(), email: "buyer@example.com", token });
  });

  it("refuses anything that isn't our own callback", () => {
    const bad = [
      callback.replace(ORIGIN, "https://evil.example"),
      callback.replace("/api/auth/callback/resend", "/api/auth/callback/google"),
      callback.replace("/api/auth/callback/resend", "/redirect"),
      "javascript:alert(1)",
      `${ORIGIN}/api/auth/callback/resend?email=a%40b.c`,
      `${ORIGIN}/api/auth/callback/resend?token=short&email=a%40b.c`,
      `${ORIGIN}/api/auth/callback/resend?token=${token}&email=a%40b.c&callbackUrl=https%3A%2F%2Fevil.example`,
      callback.replace("https://", "https://user:pass@"),
      "",
      null,
      undefined,
      "not a url",
    ];
    for (const b of bad) expect(parseConfirmTarget(b, ORIGIN), String(b)).toBeNull();
  });
});
