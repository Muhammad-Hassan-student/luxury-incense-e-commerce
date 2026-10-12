import { AccountingTabs } from "@/components/admin/accounting/tabs";
import { HsnCell, HsnSuggestions } from "@/components/admin/accounting/forms";
import { Empty, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getAccountingSettings } from "@/server/accounting/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "HSN codes" };

export default async function HsnPage() {
  await requirePermission("accounting.manage");
  const [categories, settings] = await Promise.all([
    db.category.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true, hsnCode: true, products: { where: { isGiftCard: false }, orderBy: { name: "asc" }, select: { id: true, name: true, hsnCode: true, isActive: true } } },
    }),
    getAccountingSettings(),
  ]);
  const missing = categories.flatMap((c) => c.products.filter((p) => !p.hsnCode && !c.hsnCode && !settings.defaultHsn));

  return (
    <>
      <PageHeader eyebrow="Finance" title="HSN codes">
        Set a code per category; override it on a product when it differs. Printed on invoices and summarised in GSTR-1.
      </PageHeader>
      <AccountingTabs active="hsn" canManage />
      <HsnSuggestions />
      {missing.length ? <p className="mb-6 text-sm text-ember">{missing.length} product{missing.length === 1 ? " has" : "s have"} no HSN code (and there is no default).</p> : null}

      {categories.length ? (
        <div className="grid gap-8">
          {categories.map((c) => (
            <Section key={c.id} title={c.name} actions={<HsnCell kind="category" id={c.id} name={c.name} value={c.hsnCode ?? ""} fallback={settings.defaultHsn || undefined} />}>
              {c.products.length ? (
                <Table className="min-w-[480px]">
                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>HSN override</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.products.map((p) => (
                      <tr key={p.id}>
                        <Td className="text-sm">
                          {p.name}
                          {!p.isActive ? <span className="ml-2 text-xs text-subtle">hidden</span> : null}
                        </Td>
                        <Td>
                          <HsnCell kind="product" id={p.id} name={p.name} value={p.hsnCode ?? ""} fallback={c.hsnCode || settings.defaultHsn || undefined} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty>No products.</Empty>
              )}
            </Section>
          ))}
        </div>
      ) : (
        <Empty>No categories yet.</Empty>
      )}
    </>
  );
}
