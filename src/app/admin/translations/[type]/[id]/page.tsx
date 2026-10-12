import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/admin/ui";
import { TranslationTabs } from "@/components/admin/translations/translation-tabs";
import { can, requireAnyPermission } from "@/server/roles";
import { editorData } from "@/server/translations/service";
import { ENTITY_LABELS, isEntityType } from "@/lib/translations-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/translations/[type]/[id]">) {
  const { type } = await props.params;
  return { title: `Translations · ${isEntityType(type) ? ENTITY_LABELS[type].one : "Item"}` };
}

/** Language tabs for categories, collections and journal posts (products have them on their own page). */
export default async function TranslationEditorPage(props: PageProps<"/admin/translations/[type]/[id]">) {
  const { type, id } = await props.params;
  if (!isEntityType(type)) notFound();
  const editPerm = ENTITY_LABELS[type].permission;
  const user = await requireAnyPermission(editPerm === "content.edit" ? "content.view" : "catalog.view", editPerm);
  const sp = await props.searchParams;
  const locale = typeof sp.locale === "string" ? sp.locale : undefined;
  if (type === "product") redirect(`/admin/products/${id}#translations`);
  const data = await editorData(type, id);
  if (!data) notFound();

  return (
    <>
      <Link href="/admin/translations" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Translations
      </Link>
      <PageHeader
        eyebrow={ENTITY_LABELS[type].one}
        title={data.label}
        actions={
          data.href ? (
            <Link href={data.href} target="_blank" className="inline-flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
              View in store <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          ) : null
        }
      >
        English is edited where the {ENTITY_LABELS[type].one.toLowerCase()} lives; each language below is layered over it field by field.
      </PageHeader>
      <TranslationTabs key={data.hash} initial={data} canEdit={can(user, editPerm)} initialLocale={locale} />
    </>
  );
}
