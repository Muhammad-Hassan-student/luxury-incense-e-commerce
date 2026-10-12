import { describe, expect, it } from "vitest";
import { intlLocale, isLocale, isRtl, localeInfo, LOCALES, locales } from "./locales";
import { matchTag, negotiateLocale, parseAcceptLanguage } from "./negotiate";

describe("parseAcceptLanguage", () => {
  it("orders by weight and keeps browser order for ties", () => {
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toEqual([
      { tag: "fr-ch", q: 1 },
      { tag: "fr", q: 0.9 },
      { tag: "en", q: 0.8 },
      { tag: "de", q: 0.7 },
    ]);
    expect(parseAcceptLanguage("de;q=0.5, es;q=0.5").map((r) => r.tag)).toEqual(["de", "es"]);
  });

  it("skips malformed and zero-weight parts", () => {
    expect(parseAcceptLanguage("en;q=0, ;;, x_y, tr;q=abc, hi;q=1.5, ur")).toEqual([{ tag: "ur", q: 1 }]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("matchTag", () => {
  it("maps regional tags to the store locale", () => {
    expect(matchTag("fr-ca")).toBe("fr");
    expect(matchTag("ur-PK")).toBe("ur");
    expect(matchTag("es-419")).toBe("es");
    expect(matchTag("pt-BR")).toBeNull();
  });

  it("serves Simplified Chinese only", () => {
    expect(matchTag("zh")).toBe("zh");
    expect(matchTag("zh-CN")).toBe("zh");
    expect(matchTag("zh-Hans-SG")).toBe("zh");
    expect(matchTag("zh-TW")).toBeNull();
    expect(matchTag("zh-Hant")).toBeNull();
  });
});

describe("negotiateLocale", () => {
  it("picks the best served browser language", () => {
    expect(negotiateLocale("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(negotiateLocale("pt-BR,pt;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    expect(negotiateLocale("ar-AE,ar;q=0.9")).toBe("ar");
    expect(negotiateLocale("zh-CN,zh;q=0.9")).toBe("zh");
  });

  it("falls back to English", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("pt-BR,ja;q=0.8")).toBe("en");
    expect(negotiateLocale("zh-TW")).toBe("en");
    expect(negotiateLocale("*")).toBe("en");
  });

  it("uses the country only as a tie-breaker", () => {
    // Pakistan: Urdu only when the browser lists it too.
    expect(negotiateLocale("en-US,en;q=0.9,ur;q=0.8", "PK")).toBe("ur");
    expect(negotiateLocale("en-US,en;q=0.9", "PK")).toBe("en");
    expect(negotiateLocale("en-US,en;q=0.9,ur;q=0.2", "PK")).toBe("en");
    // Without the country the browser's top choice stands.
    expect(negotiateLocale("en-US,en;q=0.9,ur;q=0.8")).toBe("en");
    // A country never overrides a browser that doesn't list its language.
    expect(negotiateLocale("fr-FR", "IN")).toBe("fr");
    expect(negotiateLocale("en-IN,hi;q=0.9", "in")).toBe("hi");
  });
});

describe("locale table", () => {
  it("has English first and every code valid", () => {
    expect(locales[0]).toBe("en");
    expect(locales).toEqual(["en", "ur", "ar", "hi", "fr", "es", "de", "tr", "zh"]);
    for (const l of LOCALES) expect(() => new Intl.DateTimeFormat(l.intl)).not.toThrow();
  });

  it("flags right-to-left scripts", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ur")).toBe(true);
    expect(LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code)).toEqual(["ur", "ar"]);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("xx")).toBe(false);
  });

  it("validates and falls back safely", () => {
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(localeInfo("nope").code).toBe("en");
    expect(intlLocale("hi")).toBe("hi-IN");
    expect(localeInfo("ur").font).toBe("nastaliq");
  });
});
