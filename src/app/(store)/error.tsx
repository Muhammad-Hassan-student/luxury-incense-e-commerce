"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => console.error(error), [error]);
  return (
    <div className="container-luxe grid min-h-[60svh] place-items-center text-center">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="display mt-6 text-5xl md:text-7xl">{t("title")}</h1>
        <p className="mx-auto mt-6 max-w-sm text-muted">{error.digest ? t("bodyDigest", { digest: error.digest }) : t("body")}</p>
        <Button className="mt-10" onClick={reset}>{t("retry")}</Button>
      </div>
    </div>
  );
}
