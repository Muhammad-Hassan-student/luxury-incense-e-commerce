// PWA / web push / monitoring / backups / support desk checks against the local database:
//  - service worker routing (personal, auth and API routes are never cached) and the proxy's page marking
//  - VAPID keys generated once (concurrently) and stored encrypted
//  - push subscriptions: endpoint allow-list, delivery, pruning on 410, preferences, marketing opt-out, caps, dedupe
//  - error grouping, PII scrubbing, per-group and per-IP limits, alert on a new group
//  - cron run recording (success and failure)
//  - backups exclude secrets (sessions, tokens, hashes, gift card codes)
//  - support tickets: lifecycle, order ownership, permissions, customers only see their own tickets, merge, WhatsApp
// Creates its own users / product / orders and removes them; saved settings it touches are restored.
// Run: npm run test:platform
import "./no-real-email";

export {};

const DOMAIN = "platform-check.invalid";
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  await import("dotenv/config");
  const vm = await import("node:vm");
  const { gunzipSync } = await import("node:zlib");
  const { db } = await import("@/server/db");
  const { SW_ROUTES_JS, serviceWorkerSource } = await import("@/lib/pwa/sw-source");
  const { swMayCachePage } = await import("@/lib/pwa/sw-mark");
  const P = await import("@/server/push");
  const { forgetIntegrations } = await import("@/server/integrations");
  const M = await import("@/server/monitoring");
  const { acceptClientReport, takeToken } = await import("@/server/monitoring/report");
  const B = await import("@/server/backup");
  const S = await import("@/server/support");
  const { resolvePermissions } = await import("@/lib/permissions");
  const { notifyOrderStatus } = await import("@/server/notify");

  const tag = `pfchk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const phones = [`+9198${String(Date.now()).slice(-8)}`];
  const settingKeys = ["integration:push", "monitoring:alerts"];
  const savedSettings = await db.setting.findMany({ where: { key: { in: settingKeys } } });
  const cronJob = `${tag}-job`;

  try {
    // ── 1. Service worker routing ──
    const ctx: Record<string, unknown> = { URL };
    vm.createContext(ctx);
    vm.runInContext(`${SW_ROUTES_JS}; this.swRoute = swRoute; this.swCacheablePage = swCacheablePage;`, ctx);
    const route = ctx.swRoute as (r: Record<string, unknown>) => { strategy: string };
    const cacheable = ctx.swCacheablePage as (r: Record<string, unknown>) => boolean;
    const origin = "https://maison.example";
    const nav = (path: string, extra: Record<string, unknown> = {}) => route({ url: origin + path, method: "GET", mode: "navigate", destination: "document", rsc: false, origin, ...extra }).strategy;
    const get = (path: string, extra: Record<string, unknown> = {}) => route({ url: path.startsWith("http") ? path : origin + path, method: "GET", mode: "cors", destination: "", rsc: false, origin, ...extra }).strategy;
    const neverStored = ["/api/cart", "/api/auth/session", "/api/security/face/verify", "/api/security/passkey/options", "/api/push/subscription", "/api/health"].every((p) => get(p) === "network");
    ok(neverStored, "API, auth, Face ID and passkey requests always go to the network (never cached)");
    const personalNav = ["/account", "/account/orders/MO-1", "/account/security", "/admin", "/admin/orders", "/checkout", "/checkout/success", "/cart", "/signin", "/signin/verify", "/order/confirm/abc", "/pay/xyz", "/track", "/trade/portal", "/unsubscribe"];
    ok(personalNav.every((p) => nav(p) === "network-only-fallback"), "account, admin, checkout, cart, sign-in, order/pay links: network only (offline page, never stored)");
    ok(nav("/") === "page" && nav("/shop") === "page" && nav("/product/royal-oud") === "page" && nav("/collections/winter") === "page" && nav("/journal") === "page", "catalogue pages: network-first with offline fallback");
    ok(nav("/product/x?token=abc") === "network-only-fallback" && nav("/shop?email=a@b.c") === "network-only-fallback", "URLs carrying tokens / emails are never stored");
    ok(get("/_next/static/chunks/app-abc123.js") === "static" && get("/icons/icon-192.png") === "static", "hashed static assets + icons: cache-first");
    ok(get("/uploads/products/x.webp") === "image" && get("/_next/image?url=%2Fuploads%2Fa.jpg&w=640&q=75") === "image" && get("https://res.cloudinary.com/demo/image/upload/a.jpg", { destination: "image" }) === "image", "product images (uploads, /_next/image, Cloudinary): cache-first");
    ok(get("/shop", { rsc: true, mode: "cors" }) === "network" && get("/product/x?_rsc=1") === "network", "RSC payloads are never cached");
    ok(route({ url: `${origin}/shop`, method: "POST", mode: "navigate", destination: "document", rsc: false, origin }).strategy === "network" && get("https://evil.example/x.js") === "network", "non-GET and other origins are left alone");
    const html = (h: Record<string, string>) => cacheable({ ok: true, status: 200, type: "basic", headers: h });
    ok(html({ "content-type": "text/html; charset=utf-8", "x-sw-cache": "public" }) && !html({ "content-type": "text/html; charset=utf-8" }) && !html({ "content-type": "application/json", "x-sw-cache": "public" }), "only pages marked x-sw-cache: public are stored");
    const noParams = new URLSearchParams();
    ok(swMayCachePage("/shop", ["mo_currency"], noParams) && !swMayCachePage("/shop", ["authjs.session-token"], noParams) && !swMayCachePage("/shop", ["__Secure-authjs.session-token"], noParams) && !swMayCachePage("/account", [], noParams) && !swMayCachePage("/shop", [], new URLSearchParams("aff=ABCD")), "proxy marks catalogue pages only for visitors without a session (and no ref/aff links)");
    let compiles = true;
    try {
      new vm.Script(serviceWorkerSource("test"));
    } catch {
      compiles = false;
    }
    ok(compiles && serviceWorkerSource("abc").includes('"mo-pages-" + VERSION'), "the full service worker compiles and versions its page cache");

    // ── 2. VAPID keys: generated once, stored encrypted ──
    await db.setting.deleteMany({ where: { key: "integration:push" } });
    forgetIntegrations();
    const [k1, k2, k3] = await Promise.all([P.ensureVapidKeys(), P.ensureVapidKeys(), P.ensureVapidKeys()]);
    const again = await P.ensureVapidKeys();
    ok(Boolean(k1.publicKey) && k1.publicKey === k2.publicKey && k2.publicKey === k3.publicKey && again.publicKey === k1.publicKey && [k1, k2, k3].filter((k) => k.generated).length === 1 && !again.generated, "VAPID key pair generated exactly once under concurrent first use");
    const raw = JSON.stringify((await db.setting.findUniqueOrThrow({ where: { key: "integration:push" } })).value);
    ok(!raw.includes(k1.privateKey) && !raw.includes(k1.publicKey) && raw.includes('"ct"'), "VAPID keys are stored encrypted (AES-GCM), never in plain text");

    // ── 3. Push subscriptions, delivery and pruning ──
    const sent: { endpoint: string; payload: string }[] = [];
    const gone = new Set<string>();
    P.setPushSender(async (sub, payload) => {
      if (gone.has(sub.endpoint)) return { ok: false, statusCode: 410, error: "expired" };
      sent.push({ endpoint: sub.endpoint, payload });
      return { ok: true };
    });
    const key = (n: number) => `B${"x".repeat(85)}${n}`;
    const mkUser = async (who: string, role: "CUSTOMER" | "SUPPORT" | "MANAGER" = "CUSTOMER") => {
      const u = await db.user.create({ data: { email: email(who), name: `PF ${who}`, role } });
      userIds.push(u.id);
      return u;
    };
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const epA1 = `https://fcm.googleapis.com/fcm/send/${tag}-a1`;
    const epA2 = `https://updates.push.services.mozilla.com/wpush/v2/${tag}-a2`;
    const epB = `https://web.push.apple.com/${tag}-b`;
    let rejected = false;
    try {
      await P.saveSubscription({ userId: alice.id, endpoint: "https://evil.example/collect", p256dh: key(1), auth: "authsecret123" });
    } catch (e) {
      rejected = e instanceof P.PushError;
    }
    ok(rejected, "subscriptions to unknown push hosts are refused (no server-side requests to arbitrary URLs)");
    await P.saveSubscription({ userId: alice.id, endpoint: epA1, p256dh: key(1), auth: "authsecret123", locale: "ar" });
    await P.saveSubscription({ userId: alice.id, endpoint: epA2, p256dh: key(2), auth: "authsecret456" });
    await P.saveSubscription({ userId: bob.id, endpoint: epB, p256dh: key(3), auth: "authsecret789" });
    ok((await db.pushSubscription.count({ where: { userId: alice.id } })) === 2, "subscriptions are stored per user and device");

    const product = await db.product.create({ data: { slug: tag, name: `${tag} Oud`, subtitle: "t", story: "t", family: "WOODY", model: "OIL", category: { create: { slug: tag, name: `${tag} cat`, tagline: "t", description: "t", ambient: "GLOW" } } } });
    const variant = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`.toUpperCase(), label: "12 ml", price: 100000, stock: 5 } });
    const order = await db.order.create({ data: { number: `PF-${tag}`.toUpperCase(), userId: alice.id, email: alice.email, currency: "INR", subtotal: 100000, shipping: 0, tax: 0, total: 100000, status: "SHIPPED", shippingAddress: { fullName: "PF Alice", phone: "+919800000000", city: "Delhi" } } });
    orderIds.push(order.id);

    gone.add(epA2);
    sent.length = 0;
    await notifyOrderStatus(order.id, "shipped");
    const arPayload = sent.find((s) => s.endpoint === epA1)?.payload ?? "";
    ok(sent.length === 1 && arPayload.includes(order.number) && JSON.parse(arPayload).lang === "ar" && JSON.parse(arPayload).url === `/account/orders/${order.number}`, "order status push goes out through notify.ts (localised per device)");
    ok((await db.pushSubscription.count({ where: { endpoint: epA2 } })) === 0, "a 410 Gone from the push service deletes the expired subscription");
    sent.length = 0;
    const dup = await P.pushOrderStatus(order, "shipped");
    ok(dup?.skipped === "duplicate" && sent.length === 0, "the same order notice is never pushed twice");

    // ── 4. Preferences, marketing opt-out, caps ──
    await P.savePreferences(alice.id, { orders: false });
    const off = await P.pushOrderStatus(order, "delivered");
    ok(off?.skipped === "preference", "customer turned order updates off → no order push");
    await P.savePreferences(alice.id, { orders: true });
    await db.marketingPreference.upsert({ where: { email: bob.email }, create: { email: bob.email, journeys: false }, update: { journeys: false } });
    const optedOut = await P.sendToUser(bob.id, "price_drop", { title: "t", body: "b" });
    ok(optedOut.skipped === "marketing_opt_out", "marketing pushes honour the email marketing opt-out");
    const back = await P.sendToUser(bob.id, "back_in_stock", { title: "t", body: "b" }, { dedupeKey: `${tag}-stock` });
    ok(back.sent === 1, "…but a requested back-in-stock alert still arrives");
    const { marketingPerDay } = await (await import("@/server/integrations")).getIntegration("push");
    const results = [];
    for (let i = 0; i <= marketingPerDay; i++) results.push(await P.sendToUser(alice.id, "abandoned_bag", { title: "Bag", body: `n${i}` }, { dedupeKey: `${tag}-bag-${i}` }));
    ok(results.slice(0, marketingPerDay).every((r) => r.sent === 1) && results[marketingPerDay].skipped === "daily_cap", `marketing pushes are capped at ${marketingPerDay}/day per customer`);
    // Price drop on a wishlisted product (compared with the last price seen).
    await db.wishlistItem.create({ data: { userId: bob.id, productId: product.id } });
    await db.marketingPreference.update({ where: { email: bob.email }, data: { journeys: true } });
    await P.runPriceDrops();
    await db.productVariant.update({ where: { id: variant.id }, data: { price: 80000 } });
    sent.length = 0;
    const drop = await P.runPriceDrops();
    ok(drop.drops >= 1 && sent.some((s) => s.endpoint === epB && s.payload.includes(tag)), "a price drop on a wishlisted product pushes to the customer");

    // ── 5. Errors: grouping, scrubbing, limits, alerts ──
    const alerts: { key: string }[] = [];
    M.setAlertSink((a) => alerts.push(a));
    const stack = `Error: boom\n    at loadThing (/var/task/src/server/${tag}.ts:10:5)\n    at node_modules/next/dist/x.js:1:1`;
    const e1 = await M.captureError({ source: "server", message: `Order 123 failed for priya.sharma@gmail.com phone +91 98765 43210 token=abcd1234efgh5678 (${tag})`, stack, route: "/account/orders/MO-24001" });
    const e2 = await M.captureError({ source: "server", message: `Order 456 failed for rahul@example.com phone +91 91234 56789 token=zzzz9999yyyy8888 (${tag})`, stack, route: "/account/orders/MO-24002" });
    const g = e1 ? await db.errorGroup.findUnique({ where: { id: e1.groupId }, include: { events: true } }) : null;
    ok(Boolean(e1?.isNew) && e2?.groupId === e1?.groupId && !e2?.isNew && g?.count === 2 && g.route === "/account/orders/:id", "same error with different ids / customers groups into one fingerprint (count 2, route normalised)");
    const stored = JSON.stringify(g);
    ok(!/priya|gmail|rahul|98765|91234|abcd1234|zzzz9999/.test(stored) && stored.includes("[email]") && stored.includes("[phone]") && stored.includes("token=[redacted]"), "emails, phone numbers and tokens are scrubbed before storing");
    await new Promise((r) => setTimeout(r, 300));
    ok(alerts.filter((a) => a.key.startsWith("error:")).length === 1, "a new error group alerts the owners once (repeats don't)");
    for (let i = 0; i < 25; i++) await M.captureError({ source: "client", message: `TypeError: x is undefined ${tag}`, stack: `TypeError\n    at f (https://maison.example/_next/static/chunks/app-${i}.js:1:${i})`, route: "/shop" });
    const cg = await db.errorGroup.findFirst({ where: { message: { contains: tag }, source: "client" }, include: { _count: { select: { events: true } } } });
    ok(cg?.count === 25 && cg._count.events === 20, `occurrences keep counting but stored events are capped per hour (${cg?.count} counted, ${cg?._count.events} stored)`);
    const ip = `10.9.${Math.floor(Math.random() * 200)}.1`;
    const limited = [];
    for (let i = 0; i < 22; i++) limited.push(takeToken(`client-report:${ip}`, 20, 60_000));
    ok(limited.filter(Boolean).length === 20 && !limited[21], "browser reports are rate-limited per IP (20 per window)");
    ok((await acceptClientReport({ type: "error", message: "" }, `${ip}-x`)) === "invalid" && (await acceptClientReport({ nope: true }, `${ip}-y`)) === "invalid", "malformed browser reports are rejected");

    // ── 6. Cron run recording ──
    await M.recordCronRun(cronJob, async () => ({ done: 3 }));
    let threw = false;
    try {
      await M.recordCronRun(cronJob, async () => {
        throw new Error(`broken for ${email("x")}`);
      });
    } catch {
      threw = true;
    }
    const runs = await db.cronRun.findMany({ where: { job: cronJob }, orderBy: { startedAt: "asc" } });
    ok(runs.length === 2 && runs[0].ok === true && JSON.stringify(runs[0].result) === '{"done":3}' && runs[0].durationMs !== null && runs[1].ok === false && threw && !runs[1].error?.includes(DOMAIN), "cron runs are recorded with duration and result; failures recorded (scrubbed) and rethrown");
    ok(alerts.some((a) => a.key === `cron:${cronJob}`), "a failing cron job alerts the owners");

    // ── 7. Backups exclude secrets ──
    const sessionToken = `${tag}-SESSIONTOKEN-secret`;
    await db.session.create({ data: { sessionToken, userId: alice.id, expires: new Date(Date.now() + 864e5) } });
    const gc = await db.giftCard.create({ data: { code: `GIFT-${tag}-SECRET1234`.toUpperCase(), initial: 1000, balance: 1000 } });
    const backup = await B.buildBackup();
    const json = gunzipSync(backup.gz).toString("utf8");
    const parsed = JSON.parse(json) as { tables: Record<string, Record<string, unknown>[]> };
    const keys = new Set(Object.values(parsed.tables).flatMap((rows) => rows.flatMap((r) => Object.keys(r))));
    ok(!json.includes(sessionToken) && !B.NEVER_EXPORTED.some((t) => t in parsed.tables), "no sessions, accounts, passkeys, face templates, codes or settings in the backup");
    ok(![...keys].some((k) => /token|secret|password|hash|embedding|signature/i.test(k)), "no token / secret / hash / signature columns in any table");
    ok(!json.includes(gc.code) && parsed.tables.giftCard.some((r) => r.id === gc.id && r.code === `••••${gc.code.slice(-4)}`), "gift card codes are masked to the last 4 characters");
    ok(parsed.tables.order.some((r) => r.id === order.id) && parsed.tables.user.some((r) => r.id === alice.id && !("image" in r)) && backup.bytes > 0, `orders and minimal users are included (${(backup.bytes / 1024).toFixed(0)} KB gzipped)`);
    await db.giftCard.delete({ where: { id: gc.id } });

    // ── 8. Support desk ──
    const agentUser = await mkUser("agent", "SUPPORT");
    const agent = { id: agentUser.id, name: "PF Agent", permissions: resolvePermissions("SUPPORT", null) };
    const packerRole = await db.staffRole.create({ data: { name: `${tag} packer`, permissions: ["orders.fulfil"] } });
    const packer = { id: agentUser.id, permissions: resolvePermissions("SUPPORT", packerRole.permissions) };
    const errOf = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return e instanceof S.SupportError ? e.message : `unexpected: ${e instanceof Error ? e.message : e}`;
      }
    };
    const t1 = await S.createTicket({ source: "web", subject: "Damaged bottle", body: "The cap arrived cracked.", userId: alice.id, orderNumber: order.number, tags: ["delivery"] });
    const row1 = await db.supportTicket.findUniqueOrThrow({ where: { id: t1.id } });
    ok(t1.reference === `#${row1.number}` && row1.status === "OPEN" && row1.orderId === order.id && row1.channel === "WEB" && Boolean(row1.firstResponseDueAt), `web ticket ${t1.reference} opened with order link and an SLA deadline`);
    const foreign = await errOf(() => S.createTicket({ source: "web", subject: "Not mine", body: "hello there", userId: bob.id, orderNumber: order.number }));
    ok(Boolean(foreign && !foreign.startsWith("unexpected")), "a customer can't attach someone else's order");
    ok((await S.listCustomerTickets(bob.id)).length === 0 && (await S.getCustomerTicket(bob.id, row1.number)) === null, "customers only see their own tickets");
    const denied = await errOf(() => S.staffReply(packer, t1.id, { body: "hi" }));
    const deniedList = await errOf(() => S.listInbox(packer));
    ok(Boolean(denied && deniedList && !denied.startsWith("unexpected")), "staff without support.manage can't reply or open the inbox");
    await S.staffReply(agent, t1.id, { body: "Checking with the courier.", internal: true });
    await S.staffReply(agent, t1.id, { body: "So sorry — a replacement is on its way." });
    const afterReply = await db.supportTicket.findUniqueOrThrow({ where: { id: t1.id } });
    ok(afterReply.status === "PENDING" && Boolean(afterReply.firstRespondedAt) && afterReply.assigneeId === agent.id, "staff reply → waiting on customer, SLA met, ticket taken by the replier");
    const mine = await S.getCustomerTicket(alice.id, row1.number);
    ok(mine?.messages.length === 2 && !mine.messages.some((m) => m.body.includes("courier")), "internal notes are never shown to the customer");
    await S.customerReply(alice.id, row1.number, { body: "Thank you!" });
    ok((await db.supportTicket.findUniqueOrThrow({ where: { id: t1.id } })).status === "OPEN", "customer reply reopens the ticket");
    await S.updateTicket(agent, t1.id, { status: "RESOLVED", priority: "HIGH", tags: ["Delivery", "damaged"] });
    const resolved = await db.supportTicket.findUniqueOrThrow({ where: { id: t1.id } });
    ok(resolved.status === "RESOLVED" && Boolean(resolved.resolvedAt) && resolved.priority === "HIGH" && resolved.tags.join() === "delivery,damaged", "status / priority / tags update");
    ok((await db.auditLog.count({ where: { actorId: agent.id, entity: "SupportTicket" } })) >= 3, "staff support actions are audited");
    const notAgent = await errOf(() => S.updateTicket(agent, t1.id, { assigneeId: alice.id }));
    ok(Boolean(notAgent && !notAgent.startsWith("unexpected")), "tickets can only be assigned to staff with support.manage");
    const t2 = await S.createTicket({ source: "chat", subject: "Which oud for evenings?", body: "Can a person help me choose?", userId: alice.id, externalRef: `${tag}-chat`, transcript: [{ role: "customer", text: "hi" }, { role: "assistant", text: "Hello! Let me hand you to the team." }] });
    const t2Row = await db.supportTicket.findUniqueOrThrow({ where: { id: t2.id }, include: { messages: true } });
    ok(t2Row.channel === "CHAT" && t2Row.messages.some((m) => m.internal && m.body.includes("Concierge")) && (await S.getCustomerTicket(alice.id, t2Row.number))?.messages.length === 1, "AI concierge hand-off: createTicket({ source: 'chat' }) keeps the transcript as an internal note");
    await S.mergeTickets(agent, t2.id, row1.number);
    const merged = await db.supportTicket.findUniqueOrThrow({ where: { id: t2.id } });
    ok(merged.mergedIntoId === t1.id && merged.status === "RESOLVED" && (await db.supportMessage.count({ where: { ticketId: t1.id } })) >= 6 && (await db.supportTicket.findUniqueOrThrow({ where: { id: t1.id } })).status === "OPEN", "merge moves the messages and closes the duplicate");
    const w1 = await S.ticketFromWhatsApp({ phone: phones[0], text: "Hello, is the rose attar back?" });
    const w2 = await S.ticketFromWhatsApp({ phone: phones[0], text: "Also do you ship to Dubai?" });
    ok(Boolean(w1?.created) && w2?.created === false && w2.id === w1!.id && (await db.supportMessage.count({ where: { ticketId: w1!.id } })) === 2, "WhatsApp messages open a ticket, follow-ups join it");
    const inbox = await S.listInbox(agent, { status: "ALL", q: phones[0] });
    ok(inbox.rows.length === 1 && inbox.rows[0].channel === "WHATSAPP", "inbox search finds the WhatsApp ticket by phone");
  } finally {
    P.setPushSender(null);
    M.setAlertSink(null);
    await db.supportTicket.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { phone: { in: phones } }, { email: { endsWith: `@${DOMAIN}` } }] } });
    await db.pushLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.pushSubscription.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { endpoint: { contains: tag } }] } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    // Cron failures are scrubbed ("broken for [email]"), so match the tagged route as well as the message.
    await db.errorGroup.deleteMany({ where: { OR: [{ message: { contains: tag } }, { route: { contains: tag } }] } });
    await db.cronRun.deleteMany({ where: { job: cronJob } });
    await db.whatsAppContact.deleteMany({ where: { phone: { in: phones } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await db.wishlistItem.deleteMany({ where: { userId: { in: userIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.marketingPreference.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.staffRole.deleteMany({ where: { name: { startsWith: tag } } });
    const p = await db.product.findUnique({ where: { slug: tag } });
    if (p) {
      await db.priceSnapshot.deleteMany({ where: { productId: p.id } });
      await db.product.delete({ where: { id: p.id } });
    }
    await db.category.deleteMany({ where: { slug: tag } });
    // Restore the settings this run touched (push keys, alert throttle).
    for (const k of settingKeys) {
      const before = savedSettings.find((s) => s.key === k);
      if (before) await db.setting.upsert({ where: { key: k }, create: { key: k, value: before.value as object }, update: { value: before.value as object } });
      else await db.setting.deleteMany({ where: { key: k } });
    }
    forgetIntegrations();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
