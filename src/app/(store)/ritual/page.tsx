import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { flag } from "@/server/settings";
import { ScentQuiz } from "@/components/home/scent-quiz";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("ritualTitle"), description: t("ritualDescription") };
}

export default async function RitualPage() {
  if (!(await flag("scent-quiz"))) notFound();
  return <ScentQuiz />;
}
