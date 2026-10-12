import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/server/db";
import { CART_COOKIE } from "@/server/cart";
import { cartInclude } from "@/server/cart-lines";
import { runConciergeTurn, type ConciergeEvent } from "@/server/ai/concierge";
import { conciergeWho } from "@/server/ai/identity";
import { LIMITS } from "@/server/ai/guard";

// "Ask the perfumer": one shopper message in, an NDJSON stream of ConciergeEvents out.
export const maxDuration = 60;

const bodySchema = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().max(LIMITS.maxMessageChars * 2),
  page: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  // Same-origin only: a cross-site page must not spend the AI budget on a shopper's behalf.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const who = await conciergeWho({ createGuest: true, page: parsed.data.page?.startsWith("/") ? parsed.data.page : null });

  // Cookies can't be set once the stream has started, so a guest's bag token is reserved now; the cart row
  // itself is only created if the concierge actually adds something.
  const jar = await cookies();
  let cartToken = who.userId ? null : (jar.get(CART_COOKIE)?.value ?? null);
  if (!who.userId && !cartToken) {
    cartToken = randomBytes(12).toString("hex");
    jar.set(CART_COOKIE, cartToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 60, path: "/" });
  }
  const getCart = () =>
    who.userId
      ? db.cart.upsert({ where: { userId: who.userId }, update: {}, create: { userId: who.userId }, include: cartInclude })
      : db.cart.upsert({ where: { token: cartToken! }, update: {}, create: { token: cartToken! }, include: cartInclude });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ConciergeEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // client went away
        }
      };
      try {
        await runConciergeTurn({ conversationId: parsed.data.conversationId, message: parsed.data.message }, who, { userId: who.userId, getCart }, emit, { signal: req.signal });
      } catch (e) {
        console.error("[ai] chat route failed", e instanceof Error ? e.name : "error");
        emit({ type: "error", code: "failed", text: "Something went wrong on our side. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" },
  });
}
