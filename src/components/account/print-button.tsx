"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";

/** Opens the browser print dialog (where "Save as PDF" lives). Hidden from the printout itself. */
export function PrintButton() {
  const t = useTranslations("invoice");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mo-invoice-noprint inline-flex h-10 items-center gap-2 border border-line-strong px-5 text-[0.6875rem] uppercase tracking-[0.28em] text-fg transition-colors hover:border-gold hover:text-gold"
    >
      <Printer className="size-3.5" aria-hidden />
      {t("print")}
    </button>
  );
}
