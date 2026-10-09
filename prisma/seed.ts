// Seeds the catalog, promotions, shipping, homepage content and settings.
// Idempotent: safe to re-run (upserts by slug/code/key). Run with `npx prisma db seed`.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Ambient, type Model3D, type ScentFamily } from "../src/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const categories: {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  ambient: Ambient;
  accent: string;
}[] = [
  {
    slug: "incense",
    name: "Incense",
    tagline: "Hand-rolled on bamboo",
    description: "Masala sticks rolled by hand in Bengaluru and Mysore, dried slowly in the shade.",
    ambient: "SMOKE",
    accent: "#B8945A",
  },
  {
    slug: "dhoop",
    name: "Dhoop",
    tagline: "Stickless, dense, ancient",
    description: "Pressed resin-and-herb cones and sticks with no bamboo core — a richer, cleaner smoke.",
    ambient: "SMOKE",
    accent: "#8C6A43",
  },
  {
    slug: "candles",
    name: "Candles",
    tagline: "Poured in coconut-soy wax",
    description: "Cotton-wicked candles in hand-thrown stoneware, scented with fine perfumery oils.",
    ambient: "FLAME",
    accent: "#E2582B",
  },
  {
    slug: "oils",
    name: "Attars & Oils",
    tagline: "Distilled the old way",
    description: "Deg-bhapka attars from Kannauj and aged oud oils, alcohol-free and skin-close.",
    ambient: "RIPPLE",
    accent: "#C8A46A",
  },
  {
    slug: "bakhoor",
    name: "Bakhoor",
    tagline: "Smouldering on charcoal",
    description: "Oud chips soaked in perfumed oils and honey, for burning over coal in a mabkhara.",
    ambient: "GLOW",
    accent: "#A0522D",
  },
  {
    slug: "gifts",
    name: "Gift Sets",
    tagline: "Wrapped for ritual",
    description: "Curated boxes and a build-your-own coffret, wrapped in handmade paper.",
    ambient: "UNBOX",
    accent: "#C9B79C",
  },
];

type Seed = {
  slug: string;
  name: string;
  subtitle: string;
  story: string;
  category: string;
  family: ScentFamily;
  intensity: number;
  model: Model3D;
  palette: [string, string];
  top: string[];
  heart: string[];
  base: string[];
  moods: string[];
  time: string[];
  burnTime?: string;
  origin?: string;
  featured?: boolean;
  bestseller?: boolean;
  giftCard?: boolean;
  /** [label, price in paise, compareAt?, stock] */
  variants: [string, number, number | null, number][];
};

const products: Seed[] = [
  {
    slug: "nag-champa-noir",
    name: "Nag Champa Noir",
    subtitle: "Champaca, halmaddi, smoked sandalwood",
    story:
      "Our darkest take on the classic. Halmaddi resin is folded into the masala by hand, giving a soft, honeyed smoke that lingers in fabric for hours.",
    category: "incense",
    family: "ORIENTAL",
    intensity: 4,
    model: "INCENSE",
    palette: ["#3A2A1E", "#C8A46A"],
    top: ["Champaca", "Bergamot"],
    heart: ["Frangipani", "Halmaddi"],
    base: ["Mysore sandalwood", "Benzoin"],
    moods: ["calm", "meditation"],
    time: ["evening", "night"],
    burnTime: "45 min per stick",
    origin: "Bengaluru, India",
    featured: true,
    bestseller: true,
    variants: [
      ["20 sticks", 45000, null, 120],
      ["60 sticks", 115000, 135000, 60],
    ],
  },
  {
    slug: "temple-sandal",
    name: "Temple Sandal",
    subtitle: "Sandalwood, cardamom, temple flowers",
    story:
      "The smell of a stone courtyard at dawn — creamy sandalwood brightened with green cardamom and marigold.",
    category: "incense",
    family: "WOODY",
    intensity: 3,
    model: "INCENSE",
    palette: ["#6B4A2E", "#E8C79A"],
    top: ["Cardamom"],
    heart: ["Marigold", "Jasmine sambac"],
    base: ["Sandalwood", "Musk"],
    moods: ["calm", "focus", "meditation"],
    time: ["morning"],
    burnTime: "40 min per stick",
    origin: "Mysore, India",
    bestseller: true,
    variants: [
      ["20 sticks", 42000, null, 140],
      ["60 sticks", 108000, null, 80],
    ],
  },
  {
    slug: "himalayan-cedar",
    name: "Himalayan Cedar",
    subtitle: "Deodar, juniper, cold air",
    story: "Resinous deodar from the Kullu valley with a sharp juniper top. Clears a room like mountain air.",
    category: "incense",
    family: "FRESH",
    intensity: 2,
    model: "INCENSE",
    palette: ["#2E3A2A", "#A9B79A"],
    top: ["Juniper", "Pine needle"],
    heart: ["Deodar cedar"],
    base: ["Vetiver"],
    moods: ["focus", "energy"],
    time: ["morning"],
    burnTime: "35 min per stick",
    origin: "Himachal Pradesh, India",
    variants: [["20 sticks", 39000, null, 90]],
  },
  {
    slug: "guggal-dhoop",
    name: "Guggal Dhoop",
    subtitle: "Guggul resin, camphor, cow-ghee base",
    story:
      "A traditional cleansing dhoop pressed from guggul resin and herbs, with no charcoal and no bamboo — just dense, purifying smoke.",
    category: "dhoop",
    family: "RESINOUS",
    intensity: 5,
    model: "DHOOP",
    palette: ["#2A1E16", "#8C6A43"],
    top: ["Camphor"],
    heart: ["Guggul"],
    base: ["Labdanum", "Ghee"],
    moods: ["cleansing", "meditation"],
    time: ["evening"],
    burnTime: "20 min per cone",
    origin: "Rajasthan, India",
    featured: true,
    variants: [
      ["24 cones", 36000, null, 100],
      ["72 cones", 92000, 108000, 40],
    ],
  },
  {
    slug: "loban-rose-dhoop",
    name: "Loban & Rose",
    subtitle: "Frankincense, damask rose",
    story: "Omani loban tears ground with dried Kannauj rose petals. Sacred, soft, faintly sweet.",
    category: "dhoop",
    family: "FLORAL",
    intensity: 3,
    model: "DHOOP",
    palette: ["#4A2A2E", "#D8A0A8"],
    top: ["Pink pepper"],
    heart: ["Damask rose"],
    base: ["Frankincense", "Amber"],
    moods: ["romance", "calm"],
    time: ["evening", "night"],
    burnTime: "25 min per stick",
    origin: "Kannauj, India",
    variants: [["30 sticks", 38000, null, 70]],
  },
  {
    slug: "amber-nuit-candle",
    name: "Ambre Nuit",
    subtitle: "Amber, labdanum, vanilla absolute",
    story:
      "Our signature candle. A warm amber accord poured into an obsidian stoneware vessel that becomes a planter or catch-all when the wax is gone.",
    category: "candles",
    family: "GOURMAND",
    intensity: 4,
    model: "CANDLE",
    palette: ["#1A1714", "#E2582B"],
    top: ["Saffron"],
    heart: ["Labdanum", "Tonka"],
    base: ["Vanilla absolute", "Amber"],
    moods: ["romance", "celebration"],
    time: ["night"],
    burnTime: "55 hours",
    origin: "Poured in Goa",
    featured: true,
    bestseller: true,
    variants: [
      ["Classic 220 g", 285000, null, 50],
      ["Grand 600 g", 620000, null, 15],
    ],
  },
  {
    slug: "vetiver-monsoon-candle",
    name: "Vetiver Monsoon",
    subtitle: "Khus, wet earth, green tea",
    story: "The first rain on hot red soil — petrichor, cooling khus root and a whisper of green tea.",
    category: "candles",
    family: "FRESH",
    intensity: 2,
    model: "CANDLE",
    palette: ["#2F3A30", "#9FB08A"],
    top: ["Green tea", "Petrichor"],
    heart: ["Khus"],
    base: ["Vetiver", "Cedar"],
    moods: ["calm", "focus"],
    time: ["morning", "evening"],
    burnTime: "55 hours",
    origin: "Poured in Goa",
    variants: [["Classic 220 g", 265000, null, 45]],
  },
  {
    slug: "jasmine-majlis-candle",
    name: "Jasmine Majlis",
    subtitle: "Night jasmine, oud, cardamom coffee",
    story: "An evening of hospitality: cardamom coffee poured beside garlands of night-blooming jasmine.",
    category: "candles",
    family: "FLORAL",
    intensity: 3,
    model: "CANDLE",
    palette: ["#2A2420", "#F1E6CF"],
    top: ["Cardamom", "Coffee"],
    heart: ["Night jasmine"],
    base: ["Oud", "Musk"],
    moods: ["romance", "celebration"],
    time: ["evening"],
    burnTime: "55 hours",
    origin: "Poured in Goa",
    variants: [["Classic 220 g", 275000, null, 0]],
  },
  {
    slug: "cambodi-oud-oil",
    name: "Cambodi Oud",
    subtitle: "Aged Cambodian agarwood oil",
    story:
      "Wild-harvested Cambodian oud aged for seven years. Fruity, leathery and sweet — one drop lasts a full day.",
    category: "oils",
    family: "WOODY",
    intensity: 5,
    model: "OUD",
    palette: ["#2B1A10", "#C8A46A"],
    top: ["Plum", "Leather"],
    heart: ["Agarwood"],
    base: ["Honey", "Resin"],
    moods: ["celebration", "romance"],
    time: ["evening", "night"],
    origin: "Cambodia",
    featured: true,
    variants: [
      ["3 ml", 480000, null, 25],
      ["6 ml", 890000, null, 10],
    ],
  },
  {
    slug: "mitti-attar",
    name: "Mitti Attar",
    subtitle: "Baked earth distilled into sandalwood",
    story:
      "Clay discs from the Ganges basin, baked and distilled over sandalwood oil in copper degs — the smell of first rain, bottled.",
    category: "oils",
    family: "WOODY",
    intensity: 3,
    model: "OIL",
    palette: ["#5A3A26", "#C9B79C"],
    top: ["Petrichor"],
    heart: ["Baked clay"],
    base: ["Sandalwood"],
    moods: ["calm", "sleep"],
    time: ["morning", "evening"],
    origin: "Kannauj, India",
    bestseller: true,
    variants: [
      ["6 ml", 165000, null, 60],
      ["12 ml", 295000, null, 30],
    ],
  },
  {
    slug: "shamama-attar",
    name: "Shamama",
    subtitle: "Forty herbs, spices and flowers",
    story: "A winter attar of over forty botanicals distilled over months. Spicy, smoky and deeply warming.",
    category: "oils",
    family: "SPICY",
    intensity: 5,
    model: "PERFUME",
    palette: ["#3A1E14", "#D08A4A"],
    top: ["Saffron", "Clove"],
    heart: ["Rose", "Kewda"],
    base: ["Oakmoss", "Sandalwood"],
    moods: ["celebration"],
    time: ["night"],
    origin: "Kannauj, India",
    variants: [["6 ml", 185000, null, 35]],
  },
  {
    slug: "royal-bakhoor",
    name: "Royal Bakhoor",
    subtitle: "Oud chips in rose, musk and honey",
    story:
      "Agarwood chips steeped for weeks in rose oil, white musk and wild honey. Burn on charcoal to scent rooms, hair and fabric the Gulf way.",
    category: "bakhoor",
    family: "ORIENTAL",
    intensity: 4,
    model: "BAKHOOR",
    palette: ["#2A1A12", "#B8945A"],
    top: ["Rose"],
    heart: ["Oud", "Honey"],
    base: ["White musk", "Amber"],
    moods: ["celebration", "romance"],
    time: ["evening", "night"],
    origin: "Blended in Dubai",
    featured: true,
    bestseller: true,
    variants: [
      ["40 g", 220000, null, 40],
      ["100 g", 480000, 540000, 20],
    ],
  },
  {
    slug: "saffron-mabkhara-set",
    name: "Saffron Mabkhara Set",
    subtitle: "Brass burner, charcoal & saffron bakhoor",
    story: "Everything needed to begin: a hand-beaten brass mabkhara, quick-light charcoal and our saffron bakhoor.",
    category: "bakhoor",
    family: "SPICY",
    intensity: 3,
    model: "BAKHOOR",
    palette: ["#3A2A14", "#E0B060"],
    top: ["Saffron"],
    heart: ["Oud"],
    base: ["Sandalwood"],
    moods: ["celebration"],
    time: ["evening"],
    origin: "Moradabad, India",
    variants: [["Set", 590000, null, 12]],
  },
  {
    slug: "ritual-discovery-box",
    name: "Ritual Discovery Box",
    subtitle: "Six incense, two dhoop, one candle",
    story: "Our introduction to Maison Oud: a little of everything we make, in a magnetic keepsake box.",
    category: "gifts",
    family: "WOODY",
    intensity: 3,
    model: "GIFTBOX",
    palette: ["#1A1714", "#C8A46A"],
    top: ["Assorted"],
    heart: ["Assorted"],
    base: ["Assorted"],
    moods: ["celebration", "calm"],
    time: ["morning", "evening", "night"],
    featured: true,
    variants: [["Box", 345000, 410000, 30]],
  },
  {
    slug: "build-your-coffret",
    name: "Build Your Coffret",
    subtitle: "Choose any four, we wrap them",
    story: "Pick four pieces from across the house and we'll nest them in a hand-lined coffret with your note.",
    category: "gifts",
    family: "WOODY",
    intensity: 3,
    model: "GIFTBOX",
    palette: ["#2A2420", "#C9B79C"],
    top: ["Your choice"],
    heart: ["Your choice"],
    base: ["Your choice"],
    moods: ["celebration"],
    time: ["morning", "evening", "night"],
    variants: [["Coffret (4 pieces)", 0, null, 999]],
  },
  {
    slug: "gift-card",
    name: "Gift Card",
    subtitle: "Delivered by email, with your message",
    story: "For when you'd rather they choose. Sent by email within minutes, redeemable on anything in the house for a year.",
    category: "gifts",
    family: "WOODY",
    intensity: 1,
    model: "CARD",
    palette: ["#1A1714", "#C8A46A"],
    top: [],
    heart: [],
    base: [],
    moods: [],
    time: [],
    giftCard: true,
    variants: [
      ["₹2,500", 250000, null, 100000],
      ["₹5,000", 500000, null, 100000],
      ["₹10,000", 1000000, null, 100000],
    ],
  },
];

const collections = [
  {
    slug: "evening-ritual",
    name: "The Evening Ritual",
    description: "Slow, warm fragrances for the hour the lights go down.",
    featured: true,
    products: ["nag-champa-noir", "amber-nuit-candle", "royal-bakhoor", "loban-rose-dhoop"],
  },
  {
    slug: "morning-clarity",
    name: "Morning Clarity",
    description: "Bright woods and green notes to start the day clear-headed.",
    featured: true,
    products: ["himalayan-cedar", "temple-sandal", "vetiver-monsoon-candle", "mitti-attar"],
  },
  {
    slug: "the-oud-edit",
    name: "The Oud Edit",
    description: "Agarwood in every form: oil, chip, smoke and wax.",
    featured: true,
    products: ["cambodi-oud-oil", "royal-bakhoor", "jasmine-majlis-candle", "saffron-mabkhara-set"],
  },
];

const coupons = [
  { code: "WELCOME10", description: "10% off your first order", type: "PERCENT" as const, value: 10, minSubtotal: 0 },
  { code: "RITUAL500", description: "₹500 off orders over ₹3,000", type: "FIXED" as const, value: 50000, minSubtotal: 300000 },
  { code: "FREESHIP", description: "Free shipping", type: "FREE_SHIPPING" as const, value: 0, minSubtotal: 100000 },
];

const shippingRates = [
  { id: "ship-in", name: "India — Standard", countries: ["IN"], price: 9900, freeOver: 250000, etaDays: "3–5 days", position: 0 },
  { id: "ship-in-express", name: "India — Express", countries: ["IN"], price: 24900, freeOver: null, etaDays: "1–2 days", position: 1 },
  { id: "ship-gcc", name: "Gulf (UAE, KSA, Qatar, Oman, Kuwait, Bahrain)", countries: ["AE", "SA", "QA", "OM", "KW", "BH"], price: 149900, freeOver: 1200000, etaDays: "5–8 days", position: 2 },
  { id: "ship-pk", name: "Pakistan", countries: ["PK"], price: 129900, freeOver: null, etaDays: "6–9 days", position: 3 },
  { id: "ship-intl", name: "Rest of world", countries: ["*"], price: 249900, freeOver: 2000000, etaDays: "7–12 days", position: 4 },
];

const homeBlocks = [
  { type: "hero", data: { eyebrow: "Maison Oud", title: "The art of\nslow fragrance", subtitle: "Hand-rolled incense, aged oud and candles, composed in small batches.", cta: { label: "Explore the house", href: "/shop" } } },
  { type: "collections", data: { title: "Six ways to scent a room" } },
  { type: "featured3d", data: { title: "Turn it in your hands", productSlug: "amber-nuit-candle" } },
  { type: "story", data: { eyebrow: "Our craft", title: "Made slowly, by hand", body: "Every stick is rolled by hand, every attar distilled in copper over wood fire. We work with eleven families of artisans across India and the Gulf, and we pay them before we're paid." } },
  { type: "bestsellers", data: { title: "Most loved" } },
  { type: "ritual", data: { title: "Find your ritual", subtitle: "Five questions, one scent made for you." } },
  { type: "gifting", data: { title: "Gifts, wrapped for ritual", productSlug: "ritual-discovery-box" } },
  { type: "journal", data: { title: "From the journal" } },
  { type: "newsletter", data: { title: "Letters from the atelier", subtitle: "New batches, rituals and private sales. Twice a month, never more." } },
];

const flags = [
  { key: "three-d", description: "3D product viewers and hero scene" },
  { key: "loader", description: "Cinematic first-visit loader" },
  { key: "custom-cursor", description: "Ember cursor on desktop" },
  { key: "scent-quiz", description: "Find-your-ritual quiz" },
  { key: "subscriptions", description: "Subscribe & save on consumables" },
  { key: "cod", description: "Cash on delivery at checkout" },
  { key: "reviews", description: "Product reviews" },
];

const journal = [
  {
    slug: "how-to-burn-bakhoor",
    title: "How to burn bakhoor, properly",
    excerpt: "Charcoal, a mabkhara and patience — a short guide to the Gulf's most generous ritual.",
    body: "## You'll need\n\n- A mabkhara (incense burner)\n- Quick-light charcoal\n- Bakhoor\n\n## Method\n\nLight the charcoal until it is covered in white ash, about five minutes. Place one or two pieces of bakhoor on top. Don't overload it: bakhoor should smoulder, never burn.\n\nWalk the mabkhara slowly through each room, then let guests waft the smoke into their sleeves and hair.",
  },
  {
    slug: "what-is-deg-bhapka",
    title: "Deg-bhapka: the 400-year-old way to make attar",
    excerpt: "Inside a Kannauj distillery, where copper pots and sandalwood oil still do the work.",
    body: "In Kannauj, attars are still distilled in copper degs sealed with clay. Petals or baked earth simmer over wood fire; the vapour travels through a bamboo pipe into a bhapka of sandalwood oil, which slowly absorbs the scent over weeks.\n\nNo alcohol, no shortcuts — just time.",
  },
  {
    slug: "incense-vs-dhoop",
    title: "Incense or dhoop? Choosing your smoke",
    excerpt: "Bamboo or no bamboo, and why it changes everything about the smoke.",
    body: "Incense sticks are rolled around a bamboo core, which burns alongside the masala and gives a lighter, more even smoke. Dhoop has no core — it's pure pressed material, so the smoke is denser, richer and cleaner-tasting.\n\nChoose incense for long, gentle scenting; choose dhoop for a short, powerful cleanse.",
  },
];

async function main() {
  for (const [i, c] of categories.entries()) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: { ...c, position: i },
      create: { ...c, position: i },
    });
  }
  const catIds = Object.fromEntries(
    (await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  for (const p of products) {
    const data = {
      name: p.name,
      subtitle: p.subtitle,
      story: p.story,
      categoryId: catIds[p.category],
      family: p.family,
      intensity: p.intensity,
      model: p.model,
      palette: p.palette,
      topNotes: p.top,
      heartNotes: p.heart,
      baseNotes: p.base,
      moods: p.moods,
      timeOfDay: p.time,
      burnTime: p.burnTime ?? null,
      origin: p.origin ?? null,
      isFeatured: p.featured ?? false,
      isBestseller: p.bestseller ?? false,
      isGiftCard: p.giftCard ?? false,
    };
    const product = await db.product.upsert({
      where: { slug: p.slug },
      update: data,
      create: { slug: p.slug, ...data },
    });
    for (const [j, [label, price, compareAtPrice, stock]] of p.variants.entries()) {
      const sku = `${p.slug}-${label}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-$/, "");
      await db.productVariant.upsert({
        where: { sku },
        // Never overwrite live stock on re-seed.
        update: { label, price, compareAtPrice, position: j },
        create: { productId: product.id, sku, label, price, compareAtPrice, stock, position: j },
      });
    }
  }
  const productIds = Object.fromEntries(
    (await db.product.findMany({ select: { id: true, slug: true } })).map((p) => [p.slug, p.id]),
  );

  for (const [i, c] of collections.entries()) {
    const { products: slugs, ...rest } = c;
    const col = await db.collection.upsert({
      where: { slug: c.slug },
      update: { ...rest, position: i },
      create: { ...rest, position: i },
    });
    await db.collectionProduct.deleteMany({ where: { collectionId: col.id } });
    await db.collectionProduct.createMany({
      data: slugs.map((s, position) => ({ collectionId: col.id, productId: productIds[s], position })),
    });
  }

  for (const c of coupons) {
    await db.coupon.upsert({ where: { code: c.code }, update: c, create: c });
  }

  for (const r of shippingRates) {
    await db.shippingRate.upsert({ where: { id: r.id }, update: r, create: r });
  }

  if ((await db.contentBlock.count({ where: { page: "home" } })) === 0) {
    await db.contentBlock.createMany({
      data: homeBlocks.map((b, position) => ({ page: "home", position, ...b })),
    });
  }

  for (const f of flags) {
    await db.featureFlag.upsert({ where: { key: f.key }, update: { description: f.description }, create: f });
  }

  await db.setting.upsert({
    where: { key: "store" },
    update: {},
    create: {
      key: "store",
      value: {
        announcement: "Complimentary shipping across India on orders over ₹2,500",
        taxRatePercent: 18,
        taxInclusive: true,
        lowStockThreshold: 10,
      },
    },
  });

  for (const [i, j] of journal.entries()) {
    const publishedAt = new Date(Date.UTC(2026, 8, 1 + i * 7));
    await db.journalPost.upsert({
      where: { slug: j.slug },
      update: { title: j.title, excerpt: j.excerpt, body: j.body },
      create: { ...j, published: true, publishedAt },
    });
  }

  const counts = {
    categories: await db.category.count(),
    products: await db.product.count(),
    variants: await db.productVariant.count(),
    collections: await db.collection.count(),
    coupons: await db.coupon.count(),
    contentBlocks: await db.contentBlock.count(),
    journal: await db.journalPost.count(),
  };
  console.log("Seeded", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
