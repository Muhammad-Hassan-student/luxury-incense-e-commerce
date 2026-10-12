import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="container-luxe grid min-h-dvh place-items-center text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="display mt-6 text-6xl md:text-9xl">
          {t.rich("notFoundTitle", { em: (c) => <span className="italic text-gold">{c}</span> })}
        </h1>
        <p className="mx-auto mt-6 max-w-sm text-muted">{t("notFoundBody")}</p>
        <Link href="/" className="link-draw mt-10 inline-block text-[0.6875rem] uppercase tracking-[0.28em]">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
