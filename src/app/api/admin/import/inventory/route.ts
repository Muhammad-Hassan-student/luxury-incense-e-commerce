import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { ImportRejected, MAX_IMPORT_BYTES, applyImport, planImport } from "@/server/inventory-csv";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ csv: z.string().min(1, "The file is empty.").max(MAX_IMPORT_BYTES, "File is larger than 2 MB."), apply: z.boolean() });

/**
 * POST { csv, apply:false } → dry-run plan (diffs + errors).
 * POST { csv, apply:true }  → re-validates and applies everything in one transaction, or nothing if any row is invalid.
 */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!can(access, "inventory.adjust")) return Response.json({ error: "Not allowed" }, { status: 403 });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES * 2) return Response.json({ error: "File is larger than 2 MB." }, { status: 413 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON { csv, apply }" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { csv, apply } = parsed.data;

  if (!apply) return Response.json({ plan: await planImport(csv) });

  try {
    const r = await applyImport(csv, access.id);
    await audit(access.id, "inventory.import", "ProductVariant", null, {
      updated: r.updated,
      stockMoves: r.stockMoves,
      changes: r.plan.rows.slice(0, 500).map((row) => ({ sku: row.sku, changes: row.changes })),
    });
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/purchasing");
    revalidatePath("/", "layout");
    return Response.json({ applied: true, updated: r.updated, stockMoves: r.stockMoves, plan: r.plan });
  } catch (e) {
    if (e instanceof ImportRejected) return Response.json({ error: e.message, plan: e.plan }, { status: 422 });
    throw e;
  }
}
