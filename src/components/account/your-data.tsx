"use client";

import { useId, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { brand } from "@/config/brand";
import { deleteMyAccount } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Download a copy of your data, or erase your account. */
export function YourData({ email, isStaff }: { email: string; isStaff: boolean }) {
  const t = useTranslations("yourData");
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const panelId = useId();
  const ready = phrase === "DELETE" && typedEmail.trim().toLowerCase() === email.toLowerCase();

  return (
    <div className="grid gap-px border border-line bg-line md:grid-cols-2">
      <div className="bg-bg p-8">
        <p className="eyebrow mb-4">{t("downloadTitle")}</p>
        <p className="text-sm text-muted">{t("downloadBody", { points: brand.loyalty.name })}</p>
        <Button asChild variant="outline" size="sm" className="mt-6">
          <a href="/api/account/export" download>
            <span className="inline-flex items-center gap-3">
              <Download className="size-3.5" aria-hidden />
              {t("download")}
            </span>
          </a>
        </Button>
      </div>

      <div className="bg-bg p-8">
        <p className="eyebrow mb-4 !text-ember">{t("deleteTitle")}</p>
        <p className="text-sm text-muted">{t("deleteBody", { points: brand.loyalty.name })}</p>
        {isStaff ? (
          <p className="mt-6 text-sm text-muted">{t("staff")}</p>
        ) : !open ? (
          <Button variant="danger" size="sm" className="mt-6" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={panelId}>
            {t("deleteTitle")}
          </Button>
        ) : (
          <form
            id={panelId}
            className="mt-6 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready) return;
              setError(null);
              start(async () => {
                // Redirects home on success; only failures return.
                const res = await deleteMyAccount({ email: typedEmail, phrase });
                if (res && !res.ok) setError(res.error);
              });
            }}
          >
            <Field label={t("typeDelete")}>
              <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending} />
            </Field>
            <Field label={t("yourEmail")} hint={email}>
              <Input type="email" value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} autoComplete="off" disabled={pending} />
            </Field>
            {error && (
              <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <Button type="submit" variant="danger" size="sm" disabled={!ready || pending}>
                {pending ? t("deleting") : t("permanentlyDelete")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setPhrase("");
                  setTypedEmail("");
                  setError(null);
                }}
              >
                {t("keepAccount")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
