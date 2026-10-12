import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Forbidden() {
  const t = await getTranslations("errors");
  return (
    <main className="container-luxe grid min-h-dvh place-items-center text-center">
      <div>
        <p className="eyebrow">403</p>
        <h1 className="display mt-4 text-5xl md:text-7xl">{t("forbiddenTitle")}</h1>
        <p className="mt-4 text-muted">{t("forbiddenBody")}</p>
        <Link href="/" className="link-draw mt-8 inline-block text-[0.6875rem] uppercase tracking-[0.28em]">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
