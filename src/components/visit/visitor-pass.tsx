import { useTranslations } from "next-intl";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

export type PassData = {
  reference: string;
  name: string;
  company: string | null;
  groupSize: number;
  purpose: string;
  day: string;
  time: string;
  durationMins: number;
  address: string;
  status: string;
  valid: boolean;
};

/** Printable visitor pass. Server-safe; print styles isolate it on the page. */
export function VisitorPass({ pass }: { pass: PassData }) {
  const t = useTranslations("visit.pass");
  return (
    <>
      <style>{`@media print {
        @page { margin: 16mm; }
        body * { visibility: hidden !important; }
        .visit-print, .visit-print * { visibility: visible !important; color: #111 !important; border-color: #8a6d3b !important; background: transparent !important; box-shadow: none !important; }
        .visit-print { position: absolute; left: 0; top: 0; width: 100%; max-width: 160mm; }
      }`}</style>
      <article
        aria-label={t("label", { reference: pass.reference })}
        className={cn("visit-print relative overflow-hidden border border-gold/50 bg-bg-elev shadow-luxe", !pass.valid && "opacity-70")}
      >
        <div aria-hidden className="pointer-events-none absolute inset-2.5 border border-gold/20" />
        <div className="relative grid md:grid-cols-[1fr_auto]">
          <div className="p-7 md:p-10">
            <div className="flex items-start justify-between gap-6">
              <span className="font-display text-base tracking-[0.4em] text-gold">{brand.name.toUpperCase()}</span>
              <span className="text-[0.5625rem] uppercase tracking-[0.3em] text-gold">{t("title")}</span>
            </div>
            <p className="mt-10 text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("guest")}</p>
            <p className="mt-2 font-display text-4xl font-light leading-tight text-fg md:text-5xl">{pass.name}</p>
            <p className="mt-1 text-sm text-muted">
              {pass.company ? `${pass.company} · ` : ""}
              {t("purposeParty", { purpose: pass.purpose, count: pass.groupSize })}
            </p>
            <dl className="mt-10 grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("date")}</dt>
                <dd className="mt-2 font-display text-2xl text-fg">{pass.day}</dd>
              </div>
              <div>
                <dt className="text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("time")}</dt>
                <dd className="mt-2 font-display text-2xl text-fg">
                  {pass.time} <span className="text-base text-muted">· {t("minutes", { count: pass.durationMins })}</span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("address")}</dt>
                <dd className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{pass.address}</dd>
              </div>
            </dl>
          </div>
          {/* Stub, separated by a perforation */}
          <div className="relative flex flex-row items-center justify-between gap-6 border-t border-dashed border-gold/40 p-7 md:w-56 md:flex-col md:items-start md:border-s md:border-t-0 md:p-10">
            <div>
              <p className="text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("reference")}</p>
              <p className="mt-2 font-display text-3xl tracking-[0.08em] text-gold md:text-[2rem]">{pass.reference}</p>
            </div>
            <div className="text-end md:text-start">
              <p className="text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("status")}</p>
              <p className={cn("mt-2 text-sm uppercase tracking-[0.2em]", pass.valid ? "text-fg" : "text-ember")}>{pass.status}</p>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
