import { z } from "zod";
import { can, getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { getAccountingSettings } from "@/server/accounting/settings";
import {
  EXPORT_TYPES,
  buildGstr1,
  documentsInRange,
  einvoiceFor,
  gstr1Csv,
  istRange,
  prepare,
  salesRegisterCsv,
  tallyCsv,
  tallyXml,
  zohoCsv,
} from "@/server/accounting/exports";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z
  .object({ type: z.enum(EXPORT_TYPES), from: day, to: day })
  .refine((v) => v.from <= v.to, "from must not be after to")
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400_000 <= 400, "At most ~13 months per export");

/** GET /api/admin/export/accounting?type=…&from=YYYY-MM-DD&to=YYYY-MM-DD (IST days, by document date). */
export async function GET(req: Request) {
  const access = await getAccess();
  if (!access) return new Response("Sign in required", { status: 401 });
  if (!can(access, "accounting.view")) return new Response("Not allowed", { status: 403 });
  const url = new URL(req.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response("Invalid export request", { status: 400 });
  const { type, from, to } = parsed.data;

  const settings = await getAccountingSettings();
  const docs = await documentsInRange(from, to);
  const ctx = await prepare(docs);
  const name = `maison-oud-${type}-${from}_${to}`;
  let body: string;
  let contentType = "text/csv; charset=utf-8";
  let ext = "csv";
  let count = docs.length;
  const extra: Record<string, string> = {};

  switch (type) {
    case "sales-register":
      body = salesRegisterCsv(docs, ctx);
      break;
    case "gstr1-json":
    case "gstr1-csv": {
      const g = buildGstr1(docs, { gstin: settings.gstin, invoiceTotals: ctx.totals, invoiceNumbers: ctx.numbers, invoiceDates: ctx.dates }, istRange(from, to).start);
      if (type === "gstr1-json") {
        body = JSON.stringify(g.json, null, 2);
        contentType = "application/json; charset=utf-8";
        ext = "json";
      } else body = gstr1Csv(g, docs, ctx.totals);
      break;
    }
    case "tally-xml":
      body = tallyXml(docs, settings, ctx.numbers);
      contentType = "application/xml; charset=utf-8";
      ext = "xml";
      break;
    case "tally-csv":
      body = tallyCsv(docs, settings);
      break;
    case "zoho-invoices":
      body = zohoCsv(docs, "INVOICE", ctx.numbers);
      count = docs.filter((d) => d.kind === "INVOICE").length;
      break;
    case "zoho-credit-notes":
      body = zohoCsv(docs, "CREDIT_NOTE", ctx.numbers);
      count = docs.filter((d) => d.kind === "CREDIT_NOTE").length;
      break;
    case "einvoice-json": {
      const results = docs.filter((d) => d.b2b).map((d) => einvoiceFor(d, settings, ctx.numbers, ctx.dates));
      const ready = results.filter((r) => r.json);
      body = JSON.stringify(ready.map((r) => r.json), null, 2);
      contentType = "application/json; charset=utf-8";
      ext = "json";
      count = ready.length;
      extra["X-Einvoice-Skipped"] = String(results.length - ready.length);
      break;
    }
  }

  await audit(access.id, "accounting.export", "TaxDocument", null, { type, from, to, documents: count });
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${name}.${ext}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
