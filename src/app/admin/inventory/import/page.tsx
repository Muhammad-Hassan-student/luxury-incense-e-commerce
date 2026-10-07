import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvImport } from "@/components/admin/inventory/csv-import";
import { InventoryTabs } from "@/components/admin/inventory/tabs";
import { PageHeader, Section } from "@/components/admin/ui";
import { requirePermission } from "@/server/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import stock" };

export default async function InventoryImportPage() {
  await requirePermission("inventory.adjust");
  return (
    <>
      <PageHeader
        eyebrow="Stock control"
        title="Import CSV"
        actions={
          <Button asChild size="sm" variant="outline">
            <a href="/api/admin/export/inventory" download>
              <Download className="size-3.5" aria-hidden /> Export current sheet
            </a>
          </Button>
        }
      >
        Bulk-update stock counts, costs, reorder settings and barcodes. You&rsquo;ll see a preview before anything changes.
      </PageHeader>
      <InventoryTabs active="import" />

      <Section title="Upload" className="mb-8">
        <CsvImport />
      </Section>

      <Section title="Format">
        <div className="space-y-3 p-5 text-sm text-muted">
          <p>
            A header row with <code className="text-fg">sku</code> plus any of <code className="text-fg">stock</code>, <code className="text-fg">costPrice</code> (₹, e.g. 245.50), <code className="text-fg">reorderPoint</code>,{" "}
            <code className="text-fg">reorderQty</code>, <code className="text-fg">barcode</code>. Other columns (such as those in the export) are ignored, so an edited export can be uploaded as-is.
          </p>
          <p>
            An empty cell leaves the value unchanged; <code className="text-fg">-</code> clears cost, reorder settings or barcode. <code className="text-fg">stock</code> is the counted total on hand: the difference is
            recorded as an Adjust movement, and it can&rsquo;t go below units reserved for pending orders.
          </p>
          <p>Unknown SKUs are reported, never created. If any row has an error, nothing is applied.</p>
        </div>
      </Section>
    </>
  );
}
