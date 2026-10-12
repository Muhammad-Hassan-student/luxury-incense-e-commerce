// Region & multi-currency checks: India defaults, store time zone, exchange-rate feed (fake fetch) with stale handling
// and manual pins, rounding rules, display vs charge currency, base-currency conversion (preview = applied, undo
// restores exactly) and permission denials. Every setting / rate it touches is put back afterwards.
// Run: npm run test:region
import "./no-real-email";
import "dotenv/config";
import { db } from "@/server/db";
import { resolvePermissions } from "@/lib/permissions";
import { formatAmount, formatMoney, formatOrderCharge, formatOrderMoney } from "@/lib/money";
import { convertMinor, DEFAULT_REGION, detectCurrency, roundMajor, dayIn } from "@/lib/region-shared";
import { regionNow } from "@/lib/region-runtime";
import { getFxTable, getRegion, invalidateRegion, primeMoney, RegionPermissionError, REGION_KEY, saveRegion, storeTimezone, writeRegion } from "@/server/region";
import { currencyOverview, pinRate, refreshRates, setCurrencyOptions, setFxFetcher, type FetchLike } from "@/server/fx";
import { applyConversion, lastConversion, previewConversion, undoLastConversion, type Change } from "@/server/currency-conversion";
import { chargePortion, planCharge, razorpayAvailable, toProviderUnits } from "@/server/charge";
import { storeTimeZone } from "@/server/analytics";
import { storeDay } from "@/server/stock-report";
import { normalizePhone } from "@/server/whatsapp/phone";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const throwsWith = async (fn: () => Promise<unknown>, cls: new (...a: never[]) => Error) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof cls;
  }
};

const tag = `RGCHK${Date.now().toString(36).toUpperCase()}`;
const SETTING_KEYS = [REGION_KEY, "store", "fx-status", "cod-risk", "affiliates", "dashboard"];

function fakeFeed(rates: Record<string, number> | Error): FetchLike {
  return async () => {
    if (rates instanceof Error) throw rates;
    return { ok: true, status: 200, json: async () => ({ result: "success", base_code: "INR", rates: { INR: 1, ...rates } }) };
  };
}

async function main() {
  // ── Back up everything this test may touch ──
  const savedSettings = await db.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const savedRates = await db.exchangeRate.findMany();
  const priorConversionIds = (await db.currencyConversion.findMany({ select: { id: true } })).map((c) => c.id);
  const userIds: string[] = [];
  const mkUser = async (who: string, role: "OWNER" | "MANAGER" | "CUSTOMER") => {
    const u = await db.user.create({ data: { email: `${who}-${tag.toLowerCase()}@test.local`, name: who, role } });
    userIds.push(u.id);
    return { id: u.id, role, permissions: resolvePermissions(role, null) };
  };

  try {
    const owner = await mkUser("owner", "OWNER");
    const manager = await mkUser("manager", "MANAGER");
    const customer = await mkUser("customer", "CUSTOMER");

    // ── 1. Defaults = the original India behaviour ──
    await db.setting.deleteMany({ where: { key: REGION_KEY } });
    invalidateRegion();
    const r = await getRegion();
    ok(r.country === "IN" && r.timezone === "Asia/Kolkata" && r.baseCurrency === "INR" && r.displayCurrency === "INR" && r.phoneCode === "91" && r.taxLabel === "GST" && r.locale === "en-IN", "no region row → IN / Asia/Kolkata / INR / +91 / GST / en-IN");
    ok(JSON.stringify(r.enabledCurrencies) === JSON.stringify(["INR", "PKR", "AED", "USD", "GBP"]), "default enabled currencies = the original switcher (INR, PKR, AED, USD, GBP)");
    await primeMoney();
    ok(formatMoney(250000) === "₹2,500" && formatMoney(9950) === "₹99.50", `base formatting unchanged (${formatMoney(250000)}, ${formatMoney(9950)})`);
    ok((await storeTimeZone()) === "Asia/Kolkata" && regionNow().timezone === "Asia/Kolkata", "store time zone defaults to Asia/Kolkata");
    ok(normalizePhone("98765 43210") === "+919876543210" && normalizePhone("0300 1234567", "PK") === "+923001234567", "phone default +91; explicit PK works");

    // ── 2. Time zone drives day bucketing and printed dates ──
    const late = new Date("2026-10-11T18:45:00Z"); // Karachi 23:45 on the 11th, Kolkata 00:15 on the 12th
    ok(storeDay(late) === "2026-10-12", "India: 18:45Z is already the 12th");
    await writeRegion({ ...DEFAULT_REGION, country: "PK", timezone: "Asia/Karachi", phoneCode: "92", taxLabel: "Sales tax", locale: "en-PK" });
    ok((await storeTimezone()) === "Asia/Karachi" && (await storeTimeZone()) === "Asia/Karachi", "region time zone feeds reports (storeTimeZone)");
    ok(storeDay(late) === "2026-10-11" && dayIn(late, "Asia/Karachi") === "2026-10-11", "Pakistan: the same instant buckets into the 11th");
    ok(normalizePhone("0300-1234567") === "+923001234567", "phone default follows the region phone code (+92)");
    ok(await throwsWith(() => saveRegion(customer, { country: "PK" }), RegionPermissionError), "saving the region needs settings.manage");
    let baseRefused = false;
    try {
      await saveRegion(owner, { ...DEFAULT_REGION, baseCurrency: "PKR" });
    } catch (e) {
      baseRefused = /wizard/.test((e as Error).message);
    }
    ok(baseRefused, "the region form can't change the base currency (wizard only)");
    await writeRegion({ ...DEFAULT_REGION });

    // ── 3. Rate feed (fake fetch), stale handling, manual override ──
    await db.exchangeRate.deleteMany({ where: { base: "INR" } });
    setFxFetcher(fakeFeed({ PKR: 3.4, USD: 0.012, AED: 0.044, GBP: 0.009, EUR: 0.0102, KWD: 0.0037 }));
    const fetched = await refreshRates();
    ok(fetched.ok && fetched.updated === 6, `refresh stores the feed (${JSON.stringify(fetched)})`);
    ok((await getFxTable()).rates.PKR?.rate === 3.4, "live table uses the fetched rate");
    await db.exchangeRate.updateMany({ where: { base: "INR" }, data: { fetchedAt: new Date(Date.now() - 5 * 86_400_000) } });
    invalidateRegion();
    ok((await currencyOverview()).stale, "rates older than 3 days are flagged stale");
    setFxFetcher(fakeFeed(new Error("network down")));
    const failed = await refreshRates();
    const overview = await currencyOverview();
    ok(!failed.ok && overview.status.lastError === "network down" && overview.list.find((c) => c.code === "PKR")!.rate === 3.4, "failed fetch keeps the last good rates and records the error");
    setFxFetcher(fakeFeed({ PKR: 3.5, USD: 0.012, AED: 0.044, GBP: 0.009, EUR: 0.0102, KWD: 0.0037 }));
    await refreshRates();
    ok(!(await currencyOverview()).stale && (await getFxTable()).rates.PKR?.rate === 3.5, "a successful refresh clears the stale flag");
    await pinRate(owner, "PKR", 3.0);
    await refreshRates();
    const pinned = (await currencyOverview()).list.find((c) => c.code === "PKR")!;
    ok(pinned.rate === 3.0 && pinned.autoRate === 3.5 && pinned.source === "manual" && (await getFxTable()).rates.PKR?.rate === 3.0, "manual rate wins over the feed");
    await pinRate(owner, "PKR", null);
    ok((await getFxTable()).rates.PKR?.rate === 3.5, "unpinning returns to the live rate");
    ok(await throwsWith(() => pinRate(customer, "PKR", 2), RegionPermissionError), "pinning needs settings.manage");
    ok(await throwsWith(() => setCurrencyOptions(customer, "SAR", { enabled: true }), RegionPermissionError), "enabling currencies needs settings.manage");
    await setCurrencyOptions(owner, "PKR", { rounding: "n10" });
    await setCurrencyOptions(owner, "SAR", { enabled: true, rounding: "charm" });
    ok((await getRegion()).enabledCurrencies.includes("SAR") && (await getFxTable()).rates.SAR?.rounding === "charm", "enable + per-currency rounding saved");

    // ── 4. Rounding rules ──
    ok(roundMajor(3367, "n10") === 3370 && roundMajor(3367, "n50") === 3350 && roundMajor(3367, "n100") === 3400, "nearest 10 / 50 / 100");
    ok(roundMajor(30.2, "charm") === 30.99 && roundMajor(30, "charm") === 29.99 && roundMajor(30.5, "whole") === 31 && roundMajor(30.126, "exact") === 30.13, "charm .99, whole, exact");
    ok(roundMajor(0, "n100") === 0 && roundMajor(12, "n100") === 12 && roundMajor(0.4, "whole") === 1, "zero stays zero; small amounts never round to nothing");
    ok(convertMinor(100000, 3.5, "n10") === 350000 && convertMinor(99900, 3.37, "n10") === 337000 && convertMinor(99900, 0.012, "charm") === 1199, "convertMinor on minor units");
    await primeMoney();
    ok(formatMoney(99900, "PKR") === formatAmount(convertMinor(99900, 3.5, "n10"), "PKR"), `display price = base × rate, rounded (${formatMoney(99900, "PKR")})`);

    // ── 5. Display vs charge currency ──
    const fx = await getFxTable();
    const region = await getRegion();
    const payable = 123450;
    const stripePk = planCharge({ provider: "STRIPE", display: "PKR", payable, fx, region });
    ok(stripePk?.currency === "PKR" && stripePk.amount === convertMinor(payable, 3.5, "n10") && formatAmount(stripePk.amount, "PKR") === formatMoney(payable, "PKR"), "Stripe charges the display currency at exactly the shown amount");
    ok(planCharge({ provider: "COD", display: "PKR", payable, fx, region }) === null && planCharge({ provider: "RAZORPAY", display: "PKR", payable, fx, region }) === null, "COD and Razorpay charge the base currency");
    ok(planCharge({ provider: "STRIPE", display: "INR", payable, fx, region }) === null && planCharge({ provider: "STRIPE", display: "CNY", payable, fx, region }) === null, "no foreign charge for the base or a disabled currency");
    ok(razorpayAvailable({ baseCurrency: "INR" }) && !razorpayAvailable({ baseCurrency: "PKR" }), "Razorpay only while the base is INR");
    ok(toProviderUnits(1234, "KWD") === 12340 && toProviderUnits(1234, "USD") === 1234, "Stripe minor units (3-decimal KWD)");
    ok(chargePortion(payable, payable, 4321) === 4321 && chargePortion(payable / 2, payable, 4320) === 2160, "refunds convert in proportion; a full refund is exactly the charge");
    const order = { currency: "INR", chargeCurrency: "PKR", chargeAmount: stripePk!.amount, fxRate: 3.5, fxRounding: "n10" };
    ok(formatOrderCharge(payable, order) === formatMoney(payable, "PKR") && formatOrderMoney(payable, order) === formatMoney(payable, "PKR"), "order emails/invoices show the charged currency at the frozen rate");
    ok(formatOrderMoney(250000, { currency: "INR" }) === "₹2,500", "orders charged in the base show the base");
    ok(detectCurrency({ country: "PK" }, region.enabledCurrencies) === "PKR" && detectCurrency({ country: null, acceptLanguage: "ur-PK,ur;q=0.9" }, region.enabledCurrencies) === "PKR" && detectCurrency({ country: "JP" }, region.enabledCurrencies) === null, "first-visit currency from country header, then Accept-Language");

    // ── 6. Base-currency conversion: owner only, preview = applied, undo restores exactly ──
    ok(await throwsWith(() => previewConversion(manager, { to: "PKR" }), RegionPermissionError), "managers can't preview a base change");
    ok(await throwsWith(() => applyConversion(manager, { to: "PKR", confirm: "PKR" }), RegionPermissionError), "managers can't convert");
    let wrongConfirm = false;
    try {
      await applyConversion(owner, { to: "PKR", confirm: "PK" });
    } catch (e) {
      wrongConfirm = /Type PKR/.test((e as Error).message);
    }
    ok(wrongConfirm, "conversion requires typing the currency code");

    const before = {
      variants: await db.productVariant.findMany({ select: { id: true, price: true, compareAtPrice: true, costPrice: true }, orderBy: { id: "asc" } }),
      rates: await db.shippingRate.findMany({ select: { id: true, price: true, freeOver: true }, orderBy: { id: "asc" } }),
      coupons: await db.coupon.findMany({ select: { id: true, value: true, minSubtotal: true }, orderBy: { id: "asc" } }),
      cards: await db.giftCard.findMany({ select: { id: true, initial: true, balance: true }, orderBy: { id: "asc" } }),
      promos: await db.promotion.findMany({ select: { id: true, config: true }, orderBy: { id: "asc" } }),
      tiers: await db.priceTier.findMany({ select: { id: true, minOrderValue: true }, orderBy: { id: "asc" } }),
    };
    const preview = await previewConversion(owner, { to: "PKR", rounding: "n10" });
    ok(preview.rate === 3.5 && preview.changes.length > 0, `preview uses the live rate (${preview.changes.length} amounts)`);
    const applied = await applyConversion(owner, { to: "PKR", confirm: "pkr", rounding: "n10" });
    try {
      ok(JSON.stringify(applied.plan.changes) === JSON.stringify(preview.changes), "applied plan is identical to the preview");
      let mismatches = 0;
      for (const c of preview.changes) {
        if (c.kind === "row" && c.model === "productVariant") {
          const v = await db.productVariant.findUnique({ where: { id: c.key.id } });
          if ((v as Record<string, unknown> | null)?.[c.field] !== c.to) mismatches++;
        } else if (c.kind === "setting") {
          const row = await db.setting.findUnique({ where: { key: c.key } });
          if ((row?.value as Record<string, unknown>)?.[c.field] !== c.to) mismatches++;
        } else if (c.kind === "promotion") {
          const p = await db.promotion.findUnique({ where: { id: c.id } });
          if (JSON.stringify(p?.config) !== JSON.stringify(c.to)) mismatches++;
        }
      }
      ok(mismatches === 0, "database holds exactly the previewed values");
      const variantChange = preview.changes.find((c): c is Extract<Change, { kind: "row" }> => c.kind === "row" && c.field === "price");
      if (variantChange) ok(variantChange.to === convertMinor(variantChange.from!, 3.5, "n10"), "variant price = old × rate, rounded");
      const card = preview.changes.find((c): c is Extract<Change, { kind: "row" }> => c.kind === "row" && c.model === "giftCard");
      if (card) ok(card.to === convertMinor(card.from!, 3.5, "exact"), "gift card balances convert exactly (no rounding)");
      const regionNowPk = await getRegion();
      ok(regionNowPk.baseCurrency === "PKR" && (await getFxTable()).base === "PKR", "base currency is PKR");
      ok(Math.abs(((await getFxTable()).rates.INR?.rate ?? 0) - 1 / 3.5) < 1e-9, "rates re-based (1 PKR = 1/3.5 INR)");
      ok(formatMoney(350000).includes("3,500") && !formatMoney(350000).includes("₹"), `prices now format in PKR (${formatMoney(350000)})`);
      ok(planCharge({ provider: "RAZORPAY", display: "INR", payable: 1000, fx: await getFxTable(), region: regionNowPk }) === null && !razorpayAvailable(regionNowPk), "Razorpay hidden once the base isn't INR");
      ok(((await lastConversion())?.snapshot as { changes: unknown[] }).changes.length === preview.changes.length, "snapshot (backup) saved before converting");
      ok(Boolean(await db.auditLog.findFirst({ where: { actorId: owner.id, action: "currency.convert" } })), "conversion audited");
      ok(await throwsWith(() => undoLastConversion(manager), RegionPermissionError), "managers can't undo");
    } finally {
      const undo = await undoLastConversion(owner);
      ok(undo.base === "INR" && undo.editedSince === 0, `undo restored ${undo.restored} amounts`);
    }
    const after = {
      variants: await db.productVariant.findMany({ select: { id: true, price: true, compareAtPrice: true, costPrice: true }, orderBy: { id: "asc" } }),
      rates: await db.shippingRate.findMany({ select: { id: true, price: true, freeOver: true }, orderBy: { id: "asc" } }),
      coupons: await db.coupon.findMany({ select: { id: true, value: true, minSubtotal: true }, orderBy: { id: "asc" } }),
      cards: await db.giftCard.findMany({ select: { id: true, initial: true, balance: true }, orderBy: { id: "asc" } }),
      promos: await db.promotion.findMany({ select: { id: true, config: true }, orderBy: { id: "asc" } }),
      tiers: await db.priceTier.findMany({ select: { id: true, minOrderValue: true }, orderBy: { id: "asc" } }),
    };
    ok(JSON.stringify(after) === JSON.stringify(before), "undo restores every price, rate, coupon, card, promotion and tier exactly");
    ok((await getRegion()).baseCurrency === "INR" && formatMoney(250000) === "₹2,500", "base is INR again");
  } finally {
    setFxFetcher(null);
    // Put settings and rates back exactly as they were.
    await db.setting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    for (const s of savedSettings) await db.setting.create({ data: { key: s.key, value: s.value as object } });
    await db.exchangeRate.deleteMany({});
    if (savedRates.length) await db.exchangeRate.createMany({ data: savedRates });
    await db.currencyConversion.deleteMany({ where: { id: { notIn: priorConversionIds } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    invalidateRegion();
    await primeMoney();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
