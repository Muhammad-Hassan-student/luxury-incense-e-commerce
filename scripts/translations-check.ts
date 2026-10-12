// Catalogue translation checks against the local database. Never calls the Claude API: a scripted fake client is
// injected (and the real key is blanked), so this runs offline. Covers: per-field English fallback, published vs draft
// visibility, stale detection when the English changes, queue + cron idempotency, AI and translation spend caps,
// the glossary (protected names, prices, cached system prompt), human translations never overwritten automatically,
// permission denial, and the no-key path (English kept, "needs translation"). Creates its own category, collection,
// journal post and products; every row it creates or touches is removed/restored at the end.
// Run: npm run test:translations
import "./no-real-email";
process.env.ANTHROPIC_API_KEY = "";
delete process.env.AI_TRANSPORT;
import "dotenv/config";

export {};

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const FAKE_KEY = "sk-ant-test-fake-key-never-real";
const ORIGIN = process.env.TRANSLATIONS_CHECK_ORIGIN ?? "http://localhost:3000";

async function main() {
  const started = new Date();
  const { db } = await import("@/server/db");
  const I = await import("@/server/integrations");
  const { setAiClientFactory } = await import("@/server/ai/client");
  type AiParams = import("@/server/ai/client").AiParams;
  type AiMessage = import("@/server/ai/client").AiMessage;
  const S = await import("@/server/translations/service");
  const L = await import("@/server/translations/localize");
  const Src = await import("@/server/translations/source");
  const T = await import("@/server/translations/ai");
  const { resolvePermissions } = await import("@/lib/permissions");

  const tag = `trchk${Date.now().toString(36)}`;
  const ids = { products: [] as string[], category: "", collection: "", journal: "", users: [] as string[] };
  const before = {
    ai: await db.setting.findUnique({ where: { key: "integration:ai" } }),
    settings: await db.setting.findUnique({ where: { key: Src.SETTINGS_KEY } }),
    rows: await db.contentTranslation.findMany(),
  };
  const usageIds: string[] = [];

  // ── Fake Claude: echoes every field as "[locale] value" (so names, prices and numbers survive) ──
  const calls: AiParams[] = [];
  let mode: "echo" | "drop-brand" | "fail" = "echo";
  setAiClientFactory((apiKey) => {
    if (apiKey !== FAKE_KEY) throw new Error("translations-check: a non-fake key reached the client factory");
    return {
      async run(params) {
        calls.push(JSON.parse(JSON.stringify(params)) as AiParams);
        if (mode === "fail") throw new Error("scripted API failure");
        const user = String(params.messages[0].content);
        const locale = user.match(/<target code="(\w+)"/)?.[1] ?? "xx";
        const items = (user.match(/<items>\n([\s\S]*?)\n<\/items>/)?.[1] ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { key: string; fields: Record<string, string> });
        const out = {
          items: items.map((it) => ({
            key: it.key,
            fields: Object.entries(it.fields).map(([name, value]) => ({ name, value: `[${locale}] ${mode === "drop-brand" ? value.replace(/Maison Oud/g, "la Maison").replace(/₹[\d,]+/g, "") : value}` })),
          })),
        };
        return {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: JSON.stringify(out), citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 400, output_tokens: 300, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 },
        } as unknown as AiMessage;
      },
    };
  });

  const setAi = async (v: Record<string, unknown>) => {
    await db.setting.deleteMany({ where: { key: "integration:ai" } });
    I.forgetIntegrations();
    if (Object.keys(v).length) await I.saveIntegration("ai", v);
    I.forgetIntegrations();
  };
  const settings = (v: Partial<import("@/server/translations/source").TranslationSettings>) => Src.saveTranslationSettings({ auto: true, autoPublish: false, locales: ["fr", "ur"], monthlyCapUsd: 0, batchSize: 50, ...v });
  const row = (type: string, id: string, locale: string) => db.contentTranslation.findUnique({ where: { entityType_entityId_locale: { entityType: type, entityId: id, locale } } });

  try {
    // ── Fixtures ──
    const category = await db.category.create({ data: { slug: `${tag}-cat`, name: `${tag} Smoke`, tagline: "Slow smoke", description: "Resins and woods.", ambient: "SMOKE" } });
    ids.category = category.id;
    const product = await db.product.create({
      data: {
        slug: `${tag}-temple`,
        name: `${tag} Temple Resin`,
        subtitle: "Frankincense and oud, slow and low",
        story: "Hand-rolled by Maison Oud in Kannauj. Forty sticks for ₹1,150, each burning 45 min.",
        categoryId: category.id,
        family: "RESINOUS",
        model: "INCENSE",
        palette: ["#000000", "#111111"],
        topNotes: ["Frankincense", "Camphor"],
        heartNotes: ["Smoke"],
        baseNotes: ["Labdanum", "Oud"],
        variants: { create: [{ sku: `${tag}-T-1`.toUpperCase(), label: "40 sticks", price: 115000, stock: 5, position: 0 }] },
      },
    });
    ids.products.push(product.id);
    const collection = await db.collection.create({ data: { slug: `${tag}-col`, name: `${tag} Winter`, description: "Warm pieces for cold nights.", products: { create: [{ productId: product.id }] } } });
    ids.collection = collection.id;
    const post = await db.journalPost.create({ data: { slug: `${tag}-post`, title: "How to burn bakhoor", excerpt: "A short guide.", body: "## Light\n\nLight a charcoal disc.", published: true, publishedAt: new Date() } });
    ids.journal = post.id;
    const mkUser = async (role: "MANAGER" | "SUPPORT") => {
      const u = await db.user.create({ data: { email: `${role.toLowerCase()}-${tag}@translations-check.invalid`, name: role, role } });
      ids.users.push(u.id);
      return { id: u.id, permissions: resolvePermissions(role, null) };
    };
    const manager = await mkUser("MANAGER");
    const support = await mkUser("SUPPORT");
    const catalogOnly = { id: manager.id, permissions: ["catalog.view", "catalog.edit"] };

    // ── Pure helpers ──
    ok(T.glossaryProblems({ story: "By Maison Oud for ₹1,150, 45 min." }, { story: "Par la Maison pour 1150 $, 45 min." }, ["Maison Oud"]).includes("Maison Oud"), "glossary check flags a dropped house name");
    ok(T.glossaryProblems({ story: "₹2,500 and 45 min" }, { story: "₹2,500 et 45 min" }, []).length === 0, "glossary check passes when prices and numbers are kept");
    ok(T.glossaryProblems({ story: "₹2,500" }, { story: "2500 roupies" }, []).includes("₹2,500"), "glossary check flags a changed price");
    const un = T.unflatten([{ name: "topNotes.0", value: "Encens" }, { name: "topNotes.1", value: "Camphre" }, { name: "story", value: "Histoire" }], { topNotes: ["Frankincense", "Camphor"], story: "Story" });
    ok(Array.isArray(un.topNotes) && un.topNotes.join() === "Encens,Camphre" && un.story === "Histoire", "lists (scent notes) round-trip through the flattened schema");
    ok(Src.hashFields({ a: "x", b: ["1"] }) === Src.hashFields({ b: ["1"], a: " x " }) && Src.hashFields({ a: "x" }) !== Src.hashFields({ a: "y" }), "source hash is stable over key order/whitespace and changes with the text");

    // ── No key: queued, English kept, "needs translation", no crash ──
    await setAi({ enabled: true, apiKey: "" });
    await settings({});
    const queued = await S.onEnglishChanged("product", product.id);
    ok(queued === 2, `an English change queues every enabled locale (${queued})`);
    ok((await S.onEnglishChanged("product", product.id)) === 0, "queueing again is a no-op (already queued)");
    const noKey = await S.runTranslationQueue({ only: { type: "product", id: product.id } });
    ok(Boolean(noKey.skipped) && noKey.translated === 0 && calls.length === 0, "without an AI key nothing is called and the run reports why");
    const nk = await row("product", product.id, "fr");
    ok(Boolean(nk?.queuedAt) && /Needs translation/.test(nk?.lastError ?? ""), "rows stay queued and are marked “needs translation”");
    ok(S.stateOf(nk, (await Src.loadSource("product", product.id))!.hash) === "needs_translation", "admin state is needs_translation");
    const enOnly = await L.getLocalized("product", { id: product.id, subtitle: product.subtitle, story: product.story }, "fr");
    ok(enOnly.subtitle === product.subtitle && !enOnly._loc, "the store keeps showing English");

    // ── Live (fake) translation → AI draft, not visible until published ──
    await setAi({ enabled: true, apiKey: FAKE_KEY, monthlyCapUsd: 0 });
    const run1 = await S.runTranslationQueue({ only: { type: "product", id: product.id }, actorId: manager.id });
    ok(run1.translated === 2 && run1.published === 0 && calls.length === 2, `queued locales translated in one call per locale (${run1.translated} rows, ${calls.length} calls)`);
    const c0 = calls[0];
    const sys = Array.isArray(c0.system) ? c0.system : [];
    ok(sys.length === 1 && "cache_control" in sys[0] && /attar/.test(sys[0].text) && /bakhoor/.test(sys[0].text) && /dhoop/.test(sys[0].text), "system prompt is the cached glossary (attar, bakhoor, dhoop)");
    ok(c0.model === "claude-sonnet-5-5" && /protected_terms/.test(String(c0.messages[0].content)) && String(c0.messages[0].content).includes(`${tag} Temple Resin`) === false, "translation model is claude-sonnet-5-5; the product name is not sent as a field");
    ok(String(c0.messages[0].content).includes('"Maison Oud"'), "the house name is passed as a protected term");
    const fr = await row("product", product.id, "fr");
    ok(fr?.status === "draft" && fr.source === "ai" && !fr.published && !fr.queuedAt, "AI output lands as an AI draft and leaves the queue");
    const frf = fr!.fields as Record<string, unknown>;
    ok(String(frf.story).includes("Maison Oud") && String(frf.story).includes("₹1,150") && Array.isArray(frf.topNotes) && (frf.topNotes as string[]).length === 2 && !("name" in frf), "translated fields keep protected terms/prices; notes stay lists; name is not AI-translated");
    const draftView = await L.getLocalized("product", { id: product.id, subtitle: product.subtitle }, "fr");
    ok(draftView.subtitle === product.subtitle, "drafts are not visible in the store");
    ok((await S.runTranslationQueue({ only: { type: "product", id: product.id } })).translated === 0 && calls.length === 2, "re-running with an empty queue makes no calls (idempotent)");

    // ── Permission denial ──
    let denied = 0;
    for (const attempt of [
      () => S.publishTranslation(support, { type: "product", id: product.id, locale: "fr" }),
      () => S.saveTranslation(support, { type: "category", id: category.id, locale: "fr", fields: { name: "x" } }),
      () => S.translateNow(support, { type: "product", id: product.id, locales: ["fr"] }),
      () => S.saveTranslation(catalogOnly, { type: "journal", id: post.id, locale: "fr", fields: { title: "x" } }),
    ]) {
      try {
        await attempt();
      } catch (e) {
        if (e instanceof S.TranslationDenied) denied++;
      }
    }
    ok(denied === 4, `catalog.edit / content.edit are enforced (${denied}/4 denied)`);

    // ── Publish → visible; per-field fallback ──
    await S.publishTranslation(manager, { type: "product", id: product.id, locale: "fr" });
    const live = await L.getLocalized("product", { id: product.id, name: product.name, subtitle: product.subtitle, story: product.story, topNotes: product.topNotes }, "fr");
    ok(live.subtitle.startsWith("[fr] ") && live.name === product.name && live._loc?.subtitle === "fr" && !live._loc?.name, "published translation shows; the untranslated name falls back to English");
    ok(Array.isArray(live.topNotes) && live.topNotes[0].startsWith("[fr] "), "translated scent notes replace the English list");
    await S.saveTranslation(manager, { type: "category", id: category.id, locale: "ur", fields: { name: "دھواں", tagline: "", description: "" }, publish: true });
    const [cat] = await L.localizeMany("category", [category], "ur");
    ok(cat.name === "دھواں" && cat.tagline === category.tagline && cat.description === category.description && cat._loc?.name === "ur" && !cat._loc?.tagline, "per-field fallback: empty translated fields show the English");
    const cards = await L.localizeProducts([{ id: product.id, name: product.name, subtitle: product.subtitle, category: { slug: category.slug, name: category.name } }], "ur");
    ok(cards[0].category?.name === "دھواں", "product cards pick up the translated category name by slug");
    const urAttrs = (await import("@/lib/translations-shared")).fieldAttrs(cat, "name");
    ok(urAttrs.dir === "rtl" && urAttrs.lang === "ur", "RTL fields carry dir=rtl");
    ok((await L.getLocalized("product", { id: product.id, subtitle: product.subtitle }, "en")).subtitle === product.subtitle, "English locale is untouched");
    ok((await L.translatedProductMatches("[fr] Frankincense", "fr")).includes(product.id), "search matches translated text");

    // ── Stale detection on English edit; human work never overwritten automatically ──
    await S.saveTranslation(manager, { type: "product", id: product.id, locale: "ur", fields: { subtitle: "لوبان اور عود", story: "ہاتھ سے بنی۔ ₹1,150" }, publish: true });
    await db.product.update({ where: { id: product.id }, data: { story: "Hand-rolled by Maison Oud in Kannauj. Forty sticks for ₹1,250, each burning 50 min." } });
    const ed = await S.editorData("product", product.id);
    const st = Object.fromEntries(ed!.cells.map((c) => [c.locale, c.state]));
    ok(st.fr === "stale" && st.ur === "stale", `editing the English marks translations stale (fr ${st.fr}, ur ${st.ur})`);
    ok(ed!.cells.find((c) => c.locale === "fr")!.sourceText?.story !== ed!.english.story, "stale rows keep the English they were made from (for the diff)");
    const requeued = await S.onEnglishChanged("product", product.id);
    ok(requeued === 1 && Boolean((await row("product", product.id, "fr"))?.queuedAt) && !(await row("product", product.id, "ur"))?.queuedAt, "AI translations are re-queued; a person's translation is only flagged stale");
    const stillLive = await L.getLocalized("product", { id: product.id, subtitle: product.subtitle }, "fr");
    ok(stillLive.subtitle.startsWith("[fr] "), "the published version stays live while the re-translation waits");

    // ── Glossary violation: kept as a draft even with auto-publish ──
    await settings({ autoPublish: true });
    mode = "drop-brand";
    const run2 = await S.runTranslationQueue({ only: { type: "product", id: product.id } });
    const fr2 = await row("product", product.id, "fr");
    ok(run2.flagged === 1 && run2.published === 0 && fr2?.status === "draft" && /Maison Oud/.test(fr2.lastError ?? ""), "a translation that loses a protected term or price is flagged and not auto-published");
    mode = "echo";
    await S.translateNow(manager, { type: "product", id: product.id, locales: ["fr"] });
    const fr3 = await row("product", product.id, "fr");
    ok(fr3?.status === "published" && !fr3.lastError && String((fr3.published as Record<string, string>).story).includes("₹1,250"), "with auto-publish on, a clean AI translation goes live");

    // ── API failure keeps the queue (bounded retries) ──
    mode = "fail";
    await S.translateNow(manager, { type: "collection", id: collection.id, locales: ["fr"] });
    const colRow = await row("collection", collection.id, "fr");
    ok(Boolean(colRow?.queuedAt) && colRow?.attempts === 1 && /scripted API failure/.test(colRow.lastError ?? ""), "an API failure leaves the row queued with the error");
    mode = "echo";

    // ── Spend caps ──
    await settings({ monthlyCapUsd: 0.000001 });
    const u1 = await db.aiUsage.create({ data: { feature: "translation", model: "claude-sonnet-5-5", costMicros: 5, mock: false } });
    usageIds.push(u1.id);
    const callsBefore = calls.length;
    const capped = await S.runTranslationQueue({ only: { type: "collection", id: collection.id } });
    ok(Boolean(capped.skipped) && /translation budget/.test(capped.skipped ?? "") && calls.length === callsBefore, "the monthly translation budget stops runs before calling Claude");
    await settings({ monthlyCapUsd: 0 });
    await setAi({ enabled: true, apiKey: FAKE_KEY, monthlyCapUsd: 0.000001 });
    const globalCapped = await S.runTranslationQueue({ only: { type: "collection", id: collection.id } });
    ok(Boolean(globalCapped.skipped) && /budget/.test(globalCapped.skipped ?? "") && calls.length === callsBefore, "the global AI spend cap is respected too");
    await setAi({ enabled: true, apiKey: FAKE_KEY, monthlyCapUsd: 0 });
    const usage = await db.aiUsage.findMany({ where: { feature: "translation", createdAt: { gte: started }, id: { notIn: usageIds } } });
    ok(usage.length === calls.length - 1 && usage.every((u) => u.costMicros > 0 && u.cacheReadTokens === 1500), `every Claude call is logged as "translation" usage with its cost (${usage.length})`);

    // ── Cron: scan + queue + run, idempotent ──
    await settings({ locales: ["tr"], batchSize: 500, autoPublish: false });
    const cron1 = (await S.runTranslateCron()) as { queued: number; translated: number; pending: number };
    const callsAfter1 = calls.length;
    ok(cron1.queued > 0 && cron1.translated === cron1.queued && cron1.pending === (await db.contentTranslation.count({ where: { queuedAt: { not: null } } })), `cron queues missing content and translates it (${cron1.queued} queued, ${cron1.translated} translated)`);
    ok(Boolean(await row("journal", post.id, "tr")) && Boolean(await row("category", category.id, "tr")), "cron covers journal posts and categories");
    const cron2 = (await S.runTranslateCron()) as { queued: number; translated: number };
    ok(cron2.queued === 0 && cron2.translated === 0 && calls.length === callsAfter1, "a second cron run does nothing (idempotent)");
    await settings({ auto: false });
    ok("skipped" in (await S.runTranslateCron()), "cron is a no-op when automatic translation is off");

    // ── Bulk publish ──
    const n = await S.bulkPublish(manager, { locale: "tr", type: "category" });
    ok(n >= 1 && (await row("category", category.id, "tr"))?.status === "published", `bulk publish publishes ready drafts (${n})`);

    // ── Overview ──
    const o = await S.translationsOverview();
    ok(o.matrix.length === 8 && o.items.some((i) => i.id === product.id), "overview builds the coverage matrix");

    // ── HTTP: a customer cannot open the admin page ──
    let up = false;
    try {
      const r = await fetch(`${ORIGIN}/api/auth/csrf`, { signal: AbortSignal.timeout(90_000) });
      up = r.ok && "csrfToken" in ((await r.json().catch(() => ({}))) as object);
    } catch {
      up = false;
    }
    if (up) {
      const { randomBytes } = await import("node:crypto");
      const customer = await db.user.create({ data: { email: `customer-${tag}@translations-check.invalid`, name: "C", role: "CUSTOMER" } });
      ids.users.push(customer.id);
      const token = randomBytes(24).toString("hex");
      await db.session.create({ data: { sessionToken: token, userId: customer.id, expires: new Date(Date.now() + 3600_000) } });
      await db.sessionSecondStep.create({ data: { sessionToken: token, userId: customer.id, mode: "verify", verifiedAt: new Date() } }).catch(() => null);
      const res = await fetch(`${ORIGIN}/admin/translations`, { headers: { cookie: `authjs.session-token=${token}` }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      ok(res.status === 403 || res.status === 404 || (res.status >= 300 && res.status < 400), `customer is refused /admin/translations over HTTP (${res.status})`);
    } else console.log("SKIP  HTTP checks (no dev server at " + ORIGIN + ")");
  } finally {
    setAiClientFactory(null);
    // Restore translations exactly as they were (the cron step touched real catalogue rows).
    const keep = new Set(before.rows.map((r) => r.id));
    await db.contentTranslation.deleteMany({ where: { id: { notIn: [...keep] } } });
    const { Prisma } = await import("@/generated/prisma/client");
    for (const r of before.rows) {
      const { id, createdAt: _c, updatedAt: _u, fields, published, sourceText, ...data } = r;
      void _c;
      void _u;
      const json = (v: unknown) => (v == null ? Prisma.DbNull : (v as object));
      await db.contentTranslation.update({ where: { id }, data: { ...data, fields: fields as object, published: json(published), sourceText: json(sourceText) } }).catch(() => null);
    }
    await db.aiUsage.deleteMany({ where: { createdAt: { gte: started }, OR: [{ feature: "translation" }, { id: { in: usageIds } }] } });
    await db.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await db.session.deleteMany({ where: { userId: { in: ids.users } } });
    if (ids.journal) await db.journalPost.deleteMany({ where: { id: ids.journal } });
    if (ids.collection) await db.collection.deleteMany({ where: { id: ids.collection } });
    await db.product.deleteMany({ where: { id: { in: ids.products } } });
    if (ids.category) await db.category.deleteMany({ where: { id: ids.category } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } });
    for (const [key, saved] of [["integration:ai", before.ai], [Src.SETTINGS_KEY, before.settings]] as const) {
      await db.setting.deleteMany({ where: { key } });
      if (saved) await db.setting.create({ data: { key, value: saved.value as object } });
    }
    I.forgetIntegrations();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
