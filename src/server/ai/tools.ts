import "server-only";
import { z } from "zod";
import { Prisma, ScentFamily } from "@/generated/prisma/client";
import { db } from "../db";
import { cartLines, type CartWithItems } from "../cart-lines";
import type { AiTool } from "./client";

/**
 * Concierge tools. Every answer about products, prices, stock, the bag or orders comes from here — the model
 * never invents them. Inputs are untrusted (validated with zod); outputs go back to the model as data.
 */

export type ToolContext = {
  /** Signed-in shopper, or null for guests. Order lookups are limited to this user. */
  userId: string | null;
  /** Resolves (creating if needed) the shopper's bag. Injected so tests can use their own cart. */
  getCart: () => Promise<CartWithItems>;
};

/** What the storefront renders as an inline card. Prices in minor units. */
export type ConciergeProduct = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  family: ScentFamily;
  model: string;
  palette: string[];
  image: { src: string; cutout: boolean } | null;
  variants: { id: string; label: string; price: number; available: number }[];
};

export type BagView = { count: number; subtotal: number; items: { name: string; label: string; quantity: number; unitPrice: number }[] };

export type ToolOutcome = {
  ok: boolean;
  /** JSON-serialisable data for the model. */
  result: unknown;
  products?: ConciergeProduct[];
  bag?: BagView;
};

const MAX_QTY = 10;
const FAMILIES = Object.values(ScentFamily) as [ScentFamily, ...ScentFamily[]];

/** Shopper words → catalogue vocabulary (used by search and by Mock mode). Includes Hindi/Urdu/Arabic. */
export const SYNONYMS: Record<string, { notes?: string[]; families?: ScentFamily[]; moods?: string[] }> = {
  smoky: { notes: ["smoke", "oud", "frankincense", "labdanum", "benzoin", "resin", "camphor", "guggal", "loban", "sandalwood"], families: ["RESINOUS", "WOODY", "ORIENTAL"] },
  smoke: { notes: ["smoke", "oud", "frankincense", "labdanum", "resin", "camphor"], families: ["RESINOUS", "WOODY"] },
  dhuan: { notes: ["smoke", "oud", "frankincense", "labdanum", "resin", "camphor"], families: ["RESINOUS", "WOODY"] },
  "دخان": { notes: ["smoke", "oud", "frankincense", "labdanum", "resin"], families: ["RESINOUS", "WOODY"] },
  "دھواں": { notes: ["smoke", "oud", "frankincense", "labdanum", "resin"], families: ["RESINOUS", "WOODY"] },
  "धुआं": { notes: ["smoke", "oud", "frankincense", "labdanum", "resin"], families: ["RESINOUS", "WOODY"] },
  woody: { families: ["WOODY"], notes: ["sandalwood", "cedar", "oud", "vetiver"] },
  oud: { notes: ["oud"], families: ["WOODY"] },
  "عود": { notes: ["oud"], families: ["WOODY"] },
  floral: { families: ["FLORAL"], notes: ["rose", "jasmine", "champaca"] },
  rose: { notes: ["rose"] },
  gulab: { notes: ["rose"] },
  "ورد": { notes: ["rose"] },
  jasmine: { notes: ["jasmine"] },
  fresh: { families: ["FRESH"], notes: ["pine", "juniper", "vetiver", "green tea", "petrichor"] },
  sweet: { families: ["GOURMAND"], notes: ["vanilla", "honey", "amber"] },
  vanilla: { notes: ["vanilla"] },
  spicy: { families: ["SPICY"], notes: ["saffron", "clove", "cardamom", "pepper"] },
  saffron: { notes: ["saffron"] },
  kesar: { notes: ["saffron"] },
  sandalwood: { notes: ["sandalwood"] },
  chandan: { notes: ["sandalwood"] },
  earthy: { notes: ["petrichor", "vetiver"] },
  mitti: { notes: ["petrichor"] },
  calm: { moods: ["calm", "meditation"] },
  relax: { moods: ["calm", "sleep"] },
  sukoon: { moods: ["calm"] },
  sleep: { moods: ["sleep", "calm"] },
  neend: { moods: ["sleep"] },
  focus: { moods: ["focus"] },
  meditation: { moods: ["meditation"] },
  romance: { moods: ["romance"] },
  romantic: { moods: ["romance"] },
  date: { moods: ["romance"] },
  party: { moods: ["celebration"] },
  celebration: { moods: ["celebration"] },
  festive: { moods: ["celebration"] },
  diwali: { moods: ["celebration"] },
  eid: { moods: ["celebration"] },
  gift: { moods: ["celebration"] },
  cleansing: { moods: ["cleansing"] },
};

// ─────────────────────────────── Tool definitions (sent to Claude) ───────────────────────────────

export const TOOL_DEFS: AiTool[] = [
  {
    name: "search_products",
    description:
      "Search the Maison Oud catalogue. Use for any recommendation. Filters are optional and combine. Prices are in Indian rupees. Returns up to `limit` products with their sizes, prices and stock.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against names, notes and moods, e.g. 'smoky', 'rose', 'oud'." },
        families: { type: "array", items: { type: "string", enum: FAMILIES }, description: "Scent families." },
        notes: { type: "array", items: { type: "string" }, description: "Notes to look for, e.g. ['sandalwood','saffron']." },
        mood: { type: "string", description: "calm, sleep, focus, meditation, romance, celebration, cleansing, energy…" },
        max_price_inr: { type: "number", description: "Budget ceiling per piece, rupees." },
        min_price_inr: { type: "number" },
        in_stock_only: { type: "boolean", description: "Default true." },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
    },
  },
  {
    name: "get_product",
    description: "Full details of one product by slug (from search results): story, notes, intensity, burn time, sizes, prices, stock.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "recommend_similar",
    description: "Products similar to a given product (same family, shared notes and moods), in stock.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { slug: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 6 } }, required: ["slug"] },
  },
  {
    name: "add_to_bag",
    description:
      "Add a product to the shopper's bag. Only call when the shopper clearly asks to add/buy something. Use the variant id from search/get_product results (or the product slug plus size label). Returns the updated bag or an error such as sold out.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        variant_id: { type: "string" },
        product_slug: { type: "string" },
        variant_label: { type: "string", description: "Size label, e.g. '20 sticks'. Optional with product_slug." },
        quantity: { type: "integer", minimum: 1, maximum: MAX_QTY },
      },
      required: ["quantity"],
    },
  },
  {
    name: "get_order_status",
    description: "Status of the signed-in shopper's own orders (latest three, or one by number like MO-24001). Guests must sign in first.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { order_number: { type: "string" } } },
  },
];

// ─────────────────────────────── Input schemas ───────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const inputs = {
  search_products: z.strictObject({
    query: text(120).optional(),
    families: z.array(z.enum(FAMILIES)).max(7).optional(),
    notes: z.array(text(40)).max(8).optional(),
    mood: text(40).optional(),
    max_price_inr: z.number().min(0).max(10_000_000).optional(),
    min_price_inr: z.number().min(0).max(10_000_000).optional(),
    in_stock_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(8).optional(),
  }),
  get_product: z.strictObject({ slug: z.string().trim().min(1).max(120) }),
  recommend_similar: z.strictObject({ slug: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(6).optional() }),
  add_to_bag: z
    .strictObject({
      variant_id: z.string().trim().min(1).max(64).optional(),
      product_slug: z.string().trim().min(1).max(120).optional(),
      variant_label: text(60).optional(),
      quantity: z.number().int().min(1).max(MAX_QTY),
    })
    .refine((v) => v.variant_id || v.product_slug, "variant_id or product_slug is required"),
  get_order_status: z.strictObject({ order_number: z.string().trim().max(24).optional() }),
};
export type ToolName = keyof typeof inputs;
export const TOOL_NAMES = Object.keys(inputs) as ToolName[];

// ─────────────────────────────── Catalogue access ───────────────────────────────

const productSelect = {
  id: true,
  slug: true,
  name: true,
  subtitle: true,
  story: true,
  family: true,
  intensity: true,
  burnTime: true,
  origin: true,
  model: true,
  palette: true,
  topNotes: true,
  heartNotes: true,
  baseNotes: true,
  moods: true,
  timeOfDay: true,
  isBestseller: true,
  isGiftCard: true,
  ratingAvg: true,
  ratingCount: true,
  category: { select: { name: true } },
  images: { orderBy: { position: "asc" }, take: 1, select: { type: true, url: true, poster: true, cutoutUrl: true, display: true } },
  variants: { orderBy: { position: "asc" }, select: { id: true, label: true, price: true, stock: true, reserved: true } },
} satisfies Prisma.ProductSelect;
type Row = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

const avail = (v: { stock: number; reserved: number }) => Math.max(0, v.stock - v.reserved);
const rupees = (minor: number) => Math.round(minor) / 100;
/** Gift cards and the build-your-own coffret need choices on their own pages; they're never quick-added. */
const sellable = (p: Row) => !p.isGiftCard && p.variants.some((v) => v.price > 0);

/** Active catalogue (small store: one query, filtered in memory). */
export async function loadCatalogue(): Promise<Row[]> {
  return db.product.findMany({ where: { isActive: true }, select: productSelect, orderBy: [{ isBestseller: "desc" }, { ratingCount: "desc" }, { slug: "asc" }], take: 500 });
}

export function toCard(p: Row): ConciergeProduct {
  const m = p.images[0];
  const image = m ? (m.type === "IMAGE" ? (m.cutoutUrl && m.display !== "PHOTO" ? { src: m.cutoutUrl, cutout: true } : { src: m.url, cutout: false }) : m.poster ? { src: m.poster, cutout: false } : null) : null;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    family: p.family,
    model: p.model,
    palette: p.palette,
    image,
    variants: p.variants.map((v) => ({ id: v.id, label: v.label, price: v.price, available: avail(v) })),
  };
}

/** Compact, model-facing view. Never includes cost prices, suppliers or anything internal. */
function brief(p: Row, opts: { story?: boolean } = {}) {
  return {
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    category: p.category.name,
    family: p.family.toLowerCase(),
    intensity: `${p.intensity}/5`,
    notes: { top: p.topNotes, heart: p.heartNotes, base: p.baseNotes },
    moods: p.moods,
    time_of_day: p.timeOfDay,
    burn_time: p.burnTime ?? undefined,
    origin: p.origin ?? undefined,
    rating: p.ratingCount ? `${p.ratingAvg.toFixed(1)} from ${p.ratingCount} reviews` : undefined,
    bestseller: p.isBestseller || undefined,
    ...(opts.story && { story: p.story.slice(0, 600) }),
    sizes: p.variants.map((v) => ({ variant_id: v.id, label: v.label, price_inr: rupees(v.price), in_stock: avail(v) > 0, ...(avail(v) > 0 && avail(v) <= 5 && { only_left: avail(v) }) })),
  };
}

const lc = (s: string) => s.toLocaleLowerCase();
const STOP = new Set(
  "something some under below above with that this the and for want need like love smell smells scent scents perfume perfumes fragrance fragrances please show give budget price cheap best good nice more less than from have what which recommend suggest kuch chahiye mujhe koi wala wali aur".split(" "),
);
const words = (s: string) =>
  lc(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

export type SearchInput = z.infer<typeof inputs.search_products>;

/** Scored catalogue search shared by the tool and Mock mode. */
export function searchCatalogue(rows: Row[], q: SearchInput) {
  const inStockOnly = q.in_stock_only ?? true;
  const min = q.min_price_inr != null ? Math.round(q.min_price_inr * 100) : 0;
  const max = q.max_price_inr != null ? Math.round(q.max_price_inr * 100) : Number.MAX_SAFE_INTEGER;
  const terms = new Set<string>();
  const families = new Set<ScentFamily>(q.families ?? []);
  const moods = new Set<string>(q.mood ? [lc(q.mood)] : []);
  for (const n of q.notes ?? []) terms.add(lc(n));
  for (const w of q.query ? words(q.query) : []) {
    const syn = SYNONYMS[w];
    if (syn) {
      syn.notes?.forEach((n) => terms.add(n));
      syn.moods?.forEach((m) => moods.add(m));
      syn.families?.forEach((f) => families.add(f));
    } else terms.add(w);
  }
  // A mood word that is a synonym ("relax") expands to catalogue moods.
  for (const m of [...moods]) SYNONYMS[m]?.moods?.forEach((x) => moods.add(x));

  const scored = rows
    .filter(sellable)
    .map((p) => {
      const okVariants = p.variants.filter((v) => v.price > 0 && v.price >= min && v.price <= max && (!inStockOnly || avail(v) > 0));
      if (!okVariants.length) return null;
      const hay = lc([p.name, p.subtitle, ...p.topNotes, ...p.heartNotes, ...p.baseNotes].join(" | "));
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 3;
      if (families.has(p.family)) score += 2;
      for (const m of moods) if (p.moods.includes(m)) score += 2;
      const filtered = terms.size + families.size + moods.size > 0;
      if (filtered && score === 0) return null;
      return { p, score: score + (p.isBestseller ? 0.5 : 0) + p.ratingAvg / 10, variants: okVariants };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score || a.p.slug.localeCompare(b.p.slug));
  return scored.slice(0, q.limit ?? 5);
}

async function bagView(cart: CartWithItems): Promise<BagView> {
  const lines = await cartLines(cart);
  return {
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    items: lines.map((l) => ({ name: l.name, label: l.label, quantity: l.quantity, unitPrice: l.unitPrice })),
  };
}

const bagForModel = (b: BagView) => ({ items_in_bag: b.count, subtotal_inr: rupees(b.subtotal), lines: b.items.map((i) => ({ name: i.name, size: i.label, quantity: i.quantity, unit_price_inr: rupees(i.unitPrice) })) });

// ─────────────────────────────── Executors ───────────────────────────────

const fail = (error: string, extra: Record<string, unknown> = {}): ToolOutcome => ({ ok: false, result: { error, ...extra } });

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(TOOL_NAMES as string[]).includes(name)) return fail("unknown_tool");
  const tool = name as ToolName;
  const parsed = inputs[tool].safeParse(rawInput ?? {});
  if (!parsed.success) return fail("invalid_input", { detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "input"}: ${i.message}`) });
  const input = parsed.data as never;
  try {
    switch (tool) {
      case "search_products":
        return await searchProducts(input);
      case "get_product":
        return await getProduct(input);
      case "recommend_similar":
        return await recommendSimilar(input);
      case "add_to_bag":
        return await addToBag(input, ctx);
      case "get_order_status":
        return await orderStatus(input, ctx);
    }
  } catch (e) {
    console.error(`[ai] tool ${tool} failed`, e instanceof Error ? e.message : e);
    return fail("temporarily_unavailable");
  }
}

async function searchProducts(q: SearchInput): Promise<ToolOutcome> {
  const hits = searchCatalogue(await loadCatalogue(), q);
  return {
    ok: true,
    result: hits.length ? { count: hits.length, products: hits.map((h) => brief(h.p)) } : { count: 0, products: [], note: "No matching pieces. Suggest loosening a filter (budget, family or stock)." },
    products: hits.map((h) => toCard(h.p)),
  };
}

async function findBySlug(slug: string) {
  return db.product.findFirst({ where: { slug: slug.toLowerCase(), isActive: true }, select: productSelect });
}

async function getProduct({ slug }: { slug: string }): Promise<ToolOutcome> {
  const p = await findBySlug(slug);
  if (!p) return fail("unknown_product", { slug, note: "No such product. Only recommend products returned by search_products." });
  return { ok: true, result: brief(p, { story: true }), products: sellable(p) ? [toCard(p)] : [] };
}

async function recommendSimilar({ slug, limit = 3 }: { slug: string; limit?: number }): Promise<ToolOutcome> {
  const rows = await loadCatalogue();
  const base = rows.find((r) => r.slug === slug.toLowerCase());
  if (!base) return fail("unknown_product", { slug });
  const notes = new Set([...base.topNotes, ...base.heartNotes, ...base.baseNotes].map(lc));
  const ranked = rows
    .filter((p) => p.id !== base.id && sellable(p) && p.variants.some((v) => avail(v) > 0))
    .map((p) => {
      let s = p.family === base.family ? 3 : 0;
      for (const n of [...p.topNotes, ...p.heartNotes, ...p.baseNotes]) if (notes.has(lc(n))) s += 2;
      for (const m of p.moods) if (base.moods.includes(m)) s += 1;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.slug.localeCompare(b.p.slug))
    .slice(0, limit);
  return { ok: true, result: { similar_to: base.name, products: ranked.map((x) => brief(x.p)) }, products: ranked.map((x) => toCard(x.p)) };
}

async function addToBag(input: { variant_id?: string; product_slug?: string; variant_label?: string; quantity: number }, ctx: ToolContext): Promise<ToolOutcome> {
  let variant: Prisma.ProductVariantGetPayload<{ include: { product: true } }> | null = null;
  if (input.variant_id) {
    variant = await db.productVariant.findUnique({ where: { id: input.variant_id }, include: { product: true } });
    if (variant && input.product_slug && variant.product.slug !== input.product_slug.toLowerCase()) variant = null;
  } else if (input.product_slug) {
    const product = await db.product.findFirst({ where: { slug: input.product_slug.toLowerCase() }, include: { variants: { orderBy: { position: "asc" } } } });
    if (product) {
      const label = input.variant_label ? lc(input.variant_label) : null;
      const v = label ? product.variants.find((x) => lc(x.label) === label) : (product.variants.find((x) => avail(x) > 0) ?? product.variants[0]);
      if (!v && label) return fail("unknown_size", { sizes: product.variants.map((x) => x.label) });
      variant = v ? { ...v, product } : null;
    }
  }
  if (!variant || !variant.product.isActive) return fail("unknown_product", { note: "That piece isn't in the catalogue. Never guess ids; use search results." });
  if (variant.product.isGiftCard || variant.price <= 0) return fail("needs_configuration", { note: "Gift cards and the build-your-own coffret are set up on their own page." });

  const cart = await ctx.getCart();
  const existing = cart.items.find((i) => i.variantId === variant.id)?.quantity ?? 0;
  const free = avail(variant);
  const next = Math.min(existing + input.quantity, MAX_QTY);
  if (existing + input.quantity > MAX_QTY) return fail("quantity_limit", { max_per_piece: MAX_QTY, already_in_bag: existing });
  if (next > free) return fail(free > 0 ? "not_enough_stock" : "sold_out", { available: free });

  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    update: { quantity: next },
    create: { cartId: cart.id, variantId: variant.id, quantity: next },
  });
  const fresh = await ctx.getCart();
  const bag = await bagView(fresh);
  return { ok: true, result: { added: { name: variant.product.name, size: variant.label, quantity: input.quantity }, bag: bagForModel(bag) }, bag };
}

async function orderStatus({ order_number }: { order_number?: string }, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.userId) return fail("sign_in_required", { note: "Order details are only shared with the signed-in account holder. Ask them to sign in, or use /track with their order number and email." });
  const where: Prisma.OrderWhereInput = { userId: ctx.userId, ...(order_number && { number: order_number.toUpperCase() }) };
  const orders = await db.order.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: order_number ? 1 : 3,
    select: { number: true, status: true, placedAt: true, total: true, carrier: true, trackingNumber: true, codStatus: true, items: { select: { name: true, label: true, quantity: true } } },
  });
  // Same answer whether the number belongs to someone else or doesn't exist.
  if (!orders.length) return fail(order_number ? "order_not_found" : "no_orders");
  return {
    ok: true,
    result: {
      orders: orders.map((o) => ({
        number: o.number,
        status: o.status.toLowerCase(),
        placed: o.placedAt.toISOString().slice(0, 10),
        total_inr: rupees(o.total),
        items: o.items.map((i) => `${i.quantity} × ${i.name} (${i.label})`),
        carrier: o.carrier ?? undefined,
        tracking_number: o.trackingNumber ?? undefined,
        cod_confirmation: o.codStatus?.toLowerCase(),
      })),
    },
  };
}

/** Deterministic one-paragraph catalogue digest for the (cached) system prompt. */
export function catalogueDigest(rows: Row[]) {
  return rows
    .filter(sellable)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => {
      const prices = p.variants.filter((v) => v.price > 0).map((v) => v.price);
      const from = prices.length ? Math.min(...prices) : 0;
      return `- ${p.name} (${p.slug}) · ${p.category.name} · ${p.family.toLowerCase()} · notes: ${[...p.topNotes, ...p.heartNotes, ...p.baseNotes].join(", ")} · moods: ${p.moods.join(", ")} · from ₹${rupees(from)}`;
    })
    .join("\n");
}
