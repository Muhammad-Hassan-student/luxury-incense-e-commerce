"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { scentQuiz } from "@/actions/engagement";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductCard, type ProductCardView } from "@/components/product/product-card";

type Answers = { mood: string; time: string; family: string; intensity: number; form: string };

const questions: { key: keyof Answers; title: string; options: { value: string | number; label: string; hint?: string }[] }[] = [
  {
    key: "mood",
    title: "What would you like\nto feel?",
    options: [
      { value: "calm", label: "Calm", hint: "Unwinding, slowing down" },
      { value: "focus", label: "Focused", hint: "Clear-headed work" },
      { value: "romance", label: "Romantic", hint: "Warm, intimate" },
      { value: "celebration", label: "Celebratory", hint: "Hosting, festive" },
      { value: "meditation", label: "Centred", hint: "Prayer, meditation" },
      { value: "sleep", label: "Rested", hint: "Before sleep" },
    ],
  },
  {
    key: "time",
    title: "When is your\nritual?",
    options: [
      { value: "morning", label: "Morning light" },
      { value: "evening", label: "Golden hour" },
      { value: "night", label: "After dark" },
    ],
  },
  {
    key: "family",
    title: "Which of these\ndraws you in?",
    options: [
      { value: "WOODY", label: "Woods", hint: "Sandalwood, cedar, oud" },
      { value: "ORIENTAL", label: "Amber & resin", hint: "Warm, honeyed, deep" },
      { value: "FLORAL", label: "Flowers", hint: "Rose, jasmine, champaca" },
      { value: "FRESH", label: "Green & fresh", hint: "Vetiver, petrichor, tea" },
      { value: "SPICY", label: "Spice", hint: "Saffron, clove, cardamom" },
      { value: "GOURMAND", label: "Sweet", hint: "Vanilla, tonka, honey" },
    ],
  },
  {
    key: "intensity",
    title: "How present should\nit be?",
    options: [
      { value: 1, label: "A whisper" },
      { value: 3, label: "A conversation" },
      { value: 5, label: "A statement" },
    ],
  },
  {
    key: "form",
    title: "And how do you like\nto scent a room?",
    options: [
      { value: "incense", label: "Incense sticks" },
      { value: "dhoop", label: "Dhoop" },
      { value: "candles", label: "Candlelight" },
      { value: "oils", label: "On skin — attar" },
      { value: "bakhoor", label: "Bakhoor on coal" },
      { value: "any", label: "Surprise me" },
    ],
  },
];

export function ScentQuiz() {
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
        <p className="eyebrow">Find your ritual</p>
        {!results && (
          <div className="flex items-center gap-2" aria-label={`Question ${step + 1} of ${questions.length}`}>
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
              Your <span className="italic text-gold">ritual</span>
            </h1>
            <p className="mb-16 max-w-md text-muted">Composed from your answers. Begin with the first — the others are its closest companions.</p>
            <div className="grid gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
            <Button variant="outline" className="mt-16" onClick={restart}>
              Start again
            </Button>
          </motion.div>
        ) : (
          <motion.div key={step} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.7, ease }}>
            <h1 className="display mb-16 whitespace-pre-line text-5xl md:text-8xl">{q.title}</h1>
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
                  <span className="font-display text-3xl transition-colors group-hover:text-gold">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                </button>
              ))}
            </div>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="mt-10 flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.28em] text-muted hover:text-fg">
                <ArrowLeft className="size-3.5 rtl:rotate-180" /> Back
              </button>
            )}
            {pending && <p className="mt-10 font-display text-2xl italic text-muted">Composing your ritual…</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
