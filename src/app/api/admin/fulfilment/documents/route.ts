import type { NextRequest } from "next/server";
import { z } from "zod";
import { can, getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { FulfilmentError, labelsFor, manifestFor } from "@/server/courier/fulfilment";
import { CourierError } from "@/server/courier";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  doc: z.enum(["labels", "manifest"]),
  orders: z
    .string()
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(200)),
});

/** GET ?doc=labels|manifest&orders=id,id → one merged PDF (or a redirect to the courier's PDF). */
export async function GET(req: NextRequest) {
  const access = await getAccess();
  if (!access) return new Response("Sign in required", { status: 401 });
  if (!can(access, "orders.fulfil")) return new Response("Not allowed", { status: 403 });
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return new Response("Choose orders and a document", { status: 400 });
  const { doc, orders } = parsed.data;
  try {
    const res = doc === "labels" ? await labelsFor(orders) : await manifestFor(orders);
    await audit(access.id, `fulfilment.print_${doc}`, "Order", orders.length === 1 ? orders[0] : null, { count: orders.length });
    if (res.kind === "redirect") return Response.redirect(res.url, 302);
    return new Response(new Uint8Array(res.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${res.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const known = e instanceof FulfilmentError || e instanceof CourierError;
    if (!known) console.error("[fulfilment documents]", e);
    return new Response(known ? e.message : "Could not generate the document.", { status: known ? 409 : 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
