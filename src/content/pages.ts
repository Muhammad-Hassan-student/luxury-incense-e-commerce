import { brand } from "@/config/brand";

/** Static content pages. Edit the copy here; it's rendered with the journal's Markdown subset. */
export const pages: Record<string, { title: string; eyebrow: string; description: string; body: string }> = {
  about: {
    title: "Made slowly,\nby hand",
    eyebrow: "Our story",
    description: `The story of ${brand.name}: small-batch incense, attar and bakhoor made with artisan families.`,
    body: `${brand.name} began with a single question: why does so much incense smell of nothing but smoke?

The answer was time. Masala incense is meant to be rolled by hand, the paste worked with halmaddi and herbs, then dried slowly in the shade for weeks. Attars are meant to be distilled in copper degs over wood fire, the vapour drawn into sandalwood oil for a season. Shortcuts make things cheaper; they also make them hollow.

## Who makes our pieces

We work with eleven families across Bengaluru, Mysore, Kannauj, Moradabad and Dubai. Most have practised their craft for three or more generations. We pay on order, not on sale, and we publish our price breakdown to every artisan we work with.

## What we will never do

- Use charcoal-dipped "blank" sticks sprayed with synthetic perfume
- Add phthalates, DEP or artificial binders
- Rush a batch to meet a launch date

## Small batches

Most of our pieces are made in runs of a few hundred. When something sells out, it really is gone until the next batch is ready — usually three to six weeks. Leave your email on any sold-out piece and we'll write when it returns.`,
  },
  "shipping-returns": {
    title: "Shipping\n& returns",
    eyebrow: "Client care",
    description: "Delivery times, costs and our returns policy.",
    body: `## Shipping

Every order is wrapped by hand and dispatched within two working days.

- **India** — standard 3–5 days (₹99, complimentary over ₹2,500) or express 1–2 days (₹249)
- **Gulf** — 5–8 days, complimentary over ₹12,000
- **Pakistan** — 6–9 days
- **Rest of world** — 7–12 days, complimentary over ₹20,000

You'll receive a tracking number by email as soon as your order leaves the atelier. Duties for international orders are calculated by your local customs office and paid on delivery.

## Gift orders

Choose gift wrapping at checkout and we'll wrap your order in handmade paper with a hand-written note. Prices are never included in gift parcels. Add a preferred delivery date and we'll time dispatch for it.

## Returns

Unopened pieces in their original wrapping can be returned within 14 days of delivery for a full refund. Because our products are consumable and scented, we can't accept returns of opened items — unless something arrived damaged, in which case write to [${brand.email}](mailto:${brand.email}) with a photo within 48 hours and we'll replace it immediately.

Refunds are issued to your original payment method within 5–7 working days of the return arriving.`,
  },
  privacy: {
    title: "Privacy",
    eyebrow: "Legal",
    description: "How we collect and use your information.",
    body: `We collect only what we need to fulfil your order and, if you ask, to write to you.

## What we collect

- Your name, email, phone and delivery address when you place an order
- Your order history and ${brand.loyalty.name} balance when you have an account
- Payment details are handled entirely by our payment partners (Stripe and Razorpay); we never see or store your card number

## How we use it

To deliver your order, send order updates, answer your questions and — only if you subscribe — send our letters. We never sell your information.

## Cookies

We use essential cookies to keep your bag, your sign-in, your currency and your language. We don't use advertising cookies.

## Your rights

You can ask us to export or delete your data at any time by writing to [${brand.email}](mailto:${brand.email}).`,
  },
  terms: {
    title: "Terms",
    eyebrow: "Legal",
    description: "The terms that apply when you shop with us.",
    body: `By placing an order you agree to these terms.

## Orders and pricing

All prices are in Indian rupees and include applicable taxes unless stated otherwise. Prices shown in other currencies are for reference only. We reserve stock for 30 minutes while you complete payment; unpaid orders are released automatically.

## Safety

Never leave burning incense, candles or charcoal unattended. Keep away from children, pets, curtains and anything flammable. Burn on a heat-resistant surface in a ventilated room. Attars are for external use only; patch-test before first use.

## ${brand.loyalty.name}

${brand.loyalty.name} are earned on completed orders and have no cash value. We may change the programme with 30 days' notice. Points from refunded or cancelled orders are reversed.

## Contact

Questions about an order? Write to [${brand.email}](mailto:${brand.email}).`,
  },
};
