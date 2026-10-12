"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { scentQuiz } from "@/actions/engagement";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductCard, type ProductCardView } from "@/components/product/product-card";

type Answers = { mood: string; time: string; family: string; intensity: number; form: string };

const questions: { key: keyof Answers; options: { value: string | number; hint?: true }[] }[] = [
  {
    key: "mood",
    options: [
      { value: "calm", hint: true },
      { value: "focus", hint: true },
      { value: "romance", hint: true },
      { value: "celebration", hint: true },
      { value: "meditation", hint: true },
      { value: "sleep", hint: true },
    ],
  },
  { key: "time", options: [{ value: "morning" }, { value: "evening" }, { value: "night" }] },
  {
    key: "family",
    options: [
      { value: "WOODY", hint: true },
      { value: "ORIENTAL", hint: true },
      { value: "FLORAL", hint: true },
      { value: "FRESH", hint: true },
      { value: "SPICY", hint: true },
      { value: "GOURMAND", hint: true },
    ],
  },
  { key: "intensity", options: [{ value: 1 }, { value: 3 }, { value: 5 }] },
  {
    key: "form",
    options: [{ value: "incense" }, { value: "dhoop" }, { value: "candles" }, { value: "oils" }, { value: "bakhoor" }, { value: "any" }],
  },
];

export function ScentQuiz() {
  const t = useTranslations("quiz");
  const tn = useTranslations("nav");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [results, setResults] = useState<ProductCardView[] | null>(null);
  const [pending, start] = useTransition();
  const q = questions[step];

  const choose = (value: string | number) => {
    const next = { ...answers, [q.key]: value };
    setAnswers(next);
    if (step < questions.length - 1) setStep(step + 1);
    else start(async () => setResults(await scentQuiz(next as Answers)));
  };

  const restart = () => {
    setStep(0);
    setAnswers({});
    setResults(null);
  };

  return (
    <div className="container-luxe min-h-[80svh] pt-16">
      <div className="mb-16 flex items-center justify-between">
        <p className="eyebrow">{tn("ritual")}</p>
        {!results && (
          <div className="flex items-center gap-2" aria-label={t("progress", { step: step + 1, total: questions.length })}>
            {questions.map((_, i) => (
              <span key={i} className={cn("h-px w-8 transition-colors duration-700", i <= step ? "bg-gold" : "bg-line-strong")} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {results ? (
          <motion.div key="results" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease }}>
            <h1 className="display mb-6 text-6xl md:text-8xl">
              {t.rich("resultsTitle", { em: (c) => <span className="italic text-gold">{c}</span> })}
            </h1>
            <p className="mb-16 max-w-md text-muted">{t("resultsBody")}</p>
            <div className="grid gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
            <Button variant="outline" className="mt-16" onClick={restart}>
              {t("restart")}
            </Button>
          </motion.div>
        ) : (
          <motion.div key={step} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.7, ease }}>
            <h1 className="display mb-16 whitespace-pre-line text-5xl md:text-8xl">{t(`title_${q.key}`)}</h1>
            <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {q.options.map((o) => (
                <button
                  key={String(o.value)}
                  onClick={() => choose(o.value)}
                  disabled={pending}
                  className={cn(
                    "group flex min-h-36 flex-col justify-between bg-bg p-8 text-start transition-colors duration-500 hover:bg-bg-elev",
                    answers[q.key] === o.value && "bg-bg-elev",
                  )}
                >
                  <span className="font-display text-3xl transition-colors group-hover:text-gold">{t(`${q.key}_${o.value}` as Parameters<typeof t>[0])}</span>
                  {o.hint && <span className="text-xs text-muted">{t(`${q.key}_${o.value}_hint` as Parameters<typeof t>[0])}</span>}
                </button>
              ))}
            </div>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="mt-10 flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
                <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t("back")}
              </button>
            )}
            {pending && <p className="mt-10 font-display text-2xl italic text-muted">{t("composing")}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
