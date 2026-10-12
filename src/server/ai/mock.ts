import "server-only";
import { ORDER_NUMBER } from "./guard";
import { executeTool, loadCatalogue, searchCatalogue, SYNONYMS, type ToolContext, type ToolOutcome } from "./tools";

/**
 * Mock mode: a deterministic, catalogue-grounded concierge used when AI is off, has no key, is over budget or the
 * API fails. Same tools as the live model, so it can never show a product or price that isn't in the database.
 */

export type Lang = "en" | "hinglish" | "hi" | "ur" | "ar";

export function detectLang(text: string): Lang {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[؀-ۿ]/.test(text)) return /[ٹڈڑںےگکہھ]/.test(text) ? "ur" : "ar";
  if (/\b(kuch|chahiye|chahie|mera|meri|mujhe|kam|hai|hain|accha|acha|dikhao|batao|wala|wali|ke liye|se kam|tak|kya|kahan|daal|dal do)\b/i.test(text)) return "hinglish";
  return "en";
}

const NUM = /([\d][\d,]*(?:\.\d+)?)\s*(k)?/i;

/** "under 1500", "below ₹2k", "1500 se kam", "₹1,500 tak", "أقل من 1500". Returns rupees. */
export function parseBudget(text: string): number | undefined {
  const t = text.replace(/₹|rs\.?|inr|روپے|रुपये/gi, " ");
  const before = t.match(new RegExp(`(?:under|below|less than|upto|up to|within|max(?:imum)?|budget(?: of| is)?|<|أقل من|تحت|حد|से कम)\\s*${NUM.source}`, "i"));
  const after = t.match(new RegExp(`${NUM.source}\\s*(?:se kam|tak|ke andar|ke under|or less|max|से कम|तक|سے کم|تک)`, "i"));
  const m = before ?? after;
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const COPY: Record<Lang, { picks: (n: number, budget?: number) => string; none: string; signIn: string; noOrders: string; orderLine: (n: string, s: string) => string; added: (name: string, total: string) => string; addFail: string; hello: string; offTopic: string }> = {
  en: {
    picks: (n, b) => `Here ${n === 1 ? "is one piece" : `are ${n} pieces`} from the house that fit${b ? ` under ₹${b.toLocaleString("en-IN")}` : ""}:`,
    none: "I couldn’t find a piece that fits all of that. Try a slightly higher budget or another family — woody, floral, fresh, spicy, resinous or sweet.",
    signIn: "I can only share order details with the account holder — please sign in, or use Track order with your order number and email.",
    noOrders: "I don’t see an order with that number on your account.",
    orderLine: (n, s) => `Order ${n}: ${s}.`,
    added: (name, total) => `${name} is in your bag. Bag total: ${total}.`,
    addFail: "I couldn’t add that — it may be sold out. The cards below show what’s available.",
    hello: "Tell me the mood, the room or the person, and a budget — I’ll suggest a few pieces. Some favourites to start:",
    offTopic: "I’m the house perfumer, so I keep to fragrance, gifting and your orders. Here are a few favourites:",
  },
  hinglish: {
    picks: (n, b) => `Yeh ${n} piece${n === 1 ? "" : "s"} aapke liye${b ? ` ₹${b.toLocaleString("en-IN")} ke andar` : ""}:`,
    none: "Is combination mein kuch nahi mila. Budget thoda badhaiye ya koi aur family try kariye — woody, floral, fresh, spicy.",
    signIn: "Order details sirf account holder ko dikhte hain — please sign in kariye, ya Track order page par order number aur email daaliye.",
    noOrders: "Is number ka order aapke account mein nahi dikh raha.",
    orderLine: (n, s) => `Order ${n}: ${s}.`,
    added: (name, total) => `${name} bag mein daal diya. Bag total: ${total}.`,
    addFail: "Yeh add nahi ho paaya — shayad sold out hai. Neeche available pieces dekhiye.",
    hello: "Mood, kamra ya kis ke liye hai, aur budget bataiye — main kuch pieces suggest karunga. Shuru karne ke liye kuch favourites:",
    offTopic: "Main house ka perfumer hoon — fragrance, gifting aur aapke orders mein madad karta hoon. Kuch favourites:",
  },
  hi: {
    picks: (n, b) => `आपके लिए ${n} पीस${b ? ` ₹${b.toLocaleString("en-IN")} के अंदर` : ""}:`,
    none: "इन सब शर्तों पर कुछ नहीं मिला। बजट थोड़ा बढ़ाइए या कोई और खुशबू चुनिए।",
    signIn: "ऑर्डर की जानकारी केवल खाताधारक को दी जाती है — कृपया साइन इन करें, या Track order पर ऑर्डर नंबर और ईमेल डालें।",
    noOrders: "इस नंबर का ऑर्डर आपके खाते में नहीं मिला।",
    orderLine: (n, s) => `ऑर्डर ${n}: ${s}।`,
    added: (name, total) => `${name} आपके बैग में है। बैग कुल: ${total}।`,
    addFail: "यह जोड़ा नहीं जा सका — शायद स्टॉक में नहीं है।",
    hello: "मूड, कमरा या किसके लिए है, और बजट बताइए। शुरुआत के लिए कुछ पसंदीदा:",
    offTopic: "मैं यहाँ खुशबू, उपहार और आपके ऑर्डर में मदद करता हूँ। कुछ पसंदीदा:",
  },
  ur: {
    picks: (n, b) => `آپ کے لیے ${n} انتخاب${b ? ` ₹${b.toLocaleString("en-IN")} سے کم میں` : ""}:`,
    none: "ان تمام شرائط پر کچھ نہیں ملا۔ بجٹ تھوڑا بڑھائیے یا کوئی اور خوشبو آزمائیے۔",
    signIn: "آرڈر کی تفصیل صرف اکاؤنٹ ہولڈر کو دی جاتی ہے — براہ کرم سائن ان کریں، یا Track order پر آرڈر نمبر اور ای میل درج کریں۔",
    noOrders: "اس نمبر کا آرڈر آپ کے اکاؤنٹ میں نہیں ملا۔",
    orderLine: (n, s) => `آرڈر ${n}: ${s}۔`,
    added: (name, total) => `${name} آپ کے بیگ میں ہے۔ کل: ${total}۔`,
    addFail: "یہ شامل نہیں ہو سکا — شاید اسٹاک ختم ہے۔",
    hello: "موڈ، کمرہ یا کس کے لیے، اور بجٹ بتائیے۔ شروع کرنے کے لیے چند پسندیدہ:",
    offTopic: "میں یہاں خوشبو، تحائف اور آپ کے آرڈرز میں مدد کرتا ہوں۔ چند پسندیدہ:",
  },
  ar: {
    picks: (n, b) => `إليك ${n} من مختارات الدار${b ? ` بأقل من ₹${b.toLocaleString("en-IN")}` : ""}:`,
    none: "لم أجد قطعة تناسب كل ذلك. جرّب ميزانية أعلى قليلاً أو عائلة عطرية أخرى.",
    signIn: "تفاصيل الطلب متاحة لصاحب الحساب فقط — يرجى تسجيل الدخول، أو استخدام صفحة تتبع الطلب برقم الطلب والبريد الإلكتروني.",
    noOrders: "لا أجد طلباً بهذا الرقم في حسابك.",
    orderLine: (n, s) => `الطلب ${n}: ${s}.`,
    added: (name, total) => `أضفتُ ${name} إلى حقيبتك. المجموع: ${total}.`,
    addFail: "تعذّرت الإضافة — ربما نفدت الكمية.",
    hello: "أخبرني بالمزاج أو المكان أو لمن الهدية، والميزانية — وسأقترح بعض القطع. بعض المفضّلات للبداية:",
    offTopic: "أنا عطّار الدار، أساعد في العطور والهدايا وطلباتك. بعض المفضّلات:",
  },
};

const STATUS: Record<string, string> = {
  pending: "awaiting payment",
  paid: "confirmed and being prepared",
  packed: "packed, waiting for the courier",
  shipped: "on its way",
  delivered: "delivered",
  cancelled: "cancelled",
  refunded: "refunded",
};

const inr = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export type MockAnswer = { text: string; outcomes: { name: string; outcome: ToolOutcome }[] };

/** A single deterministic answer for one shopper message. */
export async function mockAnswer(message: string, ctx: ToolContext): Promise<MockAnswer> {
  const lang = detectLang(message);
  const c = COPY[lang];
  const lower = message.toLowerCase();
  const outcomes: MockAnswer["outcomes"] = [];
  const run = async (name: string, input: unknown) => {
    const outcome = await executeTool(name, input, ctx);
    outcomes.push({ name, outcome });
    return outcome;
  };

  // Orders: "where is my order", "MO-24001", "mera order kahan hai", "طلبي"
  const orderNo = message.match(ORDER_NUMBER)?.[0];
  if (orderNo || /\b(order|track|delivery status|shipment|parcel)\b|mera order|طلب|آرڈر|ऑर्डर/i.test(message)) {
    const r = await run("get_order_status", orderNo ? { order_number: orderNo } : {});
    if (!r.ok) {
      const err = (r.result as { error: string }).error;
      return { text: err === "sign_in_required" ? c.signIn : c.noOrders, outcomes };
    }
    const orders = (r.result as { orders: { number: string; status: string }[] }).orders;
    return { text: orders.map((o) => c.orderLine(o.number, STATUS[o.status] ?? o.status)).join("\n"), outcomes };
  }

  const catalogue = await loadCatalogue();

  // "add temple sandal to my bag" / "nag champa bag mein daal do"
  if (/\b(add|buy|daal|dal do|put)\b|أضف|ڈال/i.test(message)) {
    const named = catalogue.find((p) => lower.includes(p.name.toLowerCase()));
    if (named) {
      const r = await run("add_to_bag", { product_slug: named.slug, quantity: 1 });
      if (r.ok && r.bag) return { text: c.added(named.name, inr(r.bag.subtotal)), outcomes };
      return { text: c.addFail, outcomes };
    }
  }

  const budget = parseBudget(message);
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const signal = words.some((w) => SYNONYMS[w]) || catalogue.some((p) => [...p.topNotes, ...p.heartNotes, ...p.baseNotes].some((n) => words.includes(n.toLowerCase())));

  if (!signal && budget === undefined) {
    const r = await run("search_products", { limit: 3 });
    const greeting = /^(hi|hello|hey|salaam|salam|namaste|assalam|مرحبا|سلام|नमस्ते)\b/i.test(lower) || words.length <= 3 || /perfume|fragrance|scent|khushbu|خوشبو|عطر|खुशबू|gift|recommend|suggest/.test(lower);
    return { text: greeting ? c.hello : c.offTopic, outcomes: r.ok ? outcomes : [] };
  }

  const known = words.filter((w) => SYNONYMS[w]);
  const notes = [...new Set(catalogue.flatMap((p) => [...p.topNotes, ...p.heartNotes, ...p.baseNotes]).map((n) => n.toLowerCase()))].filter((n) => words.includes(n));
  const r = await run("search_products", {
    ...(known.length && { query: known.join(" ").slice(0, 120) }),
    ...(notes.length && { notes: notes.slice(0, 8) }),
    ...(budget !== undefined && { max_price_inr: budget }),
    limit: 3,
  });
  const n = r.products?.length ?? 0;
  if (!n) return { text: c.none, outcomes };
  const lines = (r.products ?? []).map((p) => {
    const inBudget = p.variants.filter((v) => v.available > 0 && (budget === undefined || v.price <= budget * 100));
    const v = inBudget.sort((a, b) => a.price - b.price)[0] ?? p.variants[0];
    return `• ${p.name} — ${p.subtitle} (${v.label}, ${inr(v.price)})`;
  });
  return { text: `${c.picks(n, budget)}\n${lines.join("\n")}`, outcomes };
}

export { searchCatalogue };
