import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { flag } from "@/server/settings";
import { ScentQuiz } from "@/components/home/scent-quiz";

export const metadata: Metadata = { title: "Find your ritual", description: "Five questions, one scent made for you." };

export default async function RitualPage() {
  if (!(await flag("scent-quiz"))) notFound();
  return <ScentQuiz />;
}
