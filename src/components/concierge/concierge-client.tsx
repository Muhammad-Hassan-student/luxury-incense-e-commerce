"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Headset, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConciergeEvent } from "@/server/ai/concierge";
import type { ConciergeProduct } from "@/server/ai/tools";
import type { Model3D } from "@/generated/prisma/enums";
import { conciergeFeedback, conciergeHandoff } from "@/actions/ai";
import { useAddToBag } from "@/components/cart/add-to-bag";
import { ProductArt } from "@/components/product/product-art";
import { MediaImage } from "@/components/media";
import { useMoney } from "@/components/money";
import { bumpBag } from "@/lib/fly-to-bag";
import { productHref } from "@/lib/product-href";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Msg = { id: string; role: "user" | "assistant"; text: string; products?: ConciergeProduct[]; notice?: string; mock?: boolean; error?: boolean };
type Saved = { conversationId: string | null; messages: Msg[]; feedback: "yes" | "no" | null };

const STORE_KEY = "mo:concierge";
let seq = 0;
const uid = () => `m${Date.now().toString(36)}${++seq}`;

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(s: Saved) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...s, messages: s.messages.slice(-40) }));
  } catch {
    // private mode / quota: the chat still works, it just won't survive a reload
  }
}

/** Tiny, safe formatter: paragraphs, "-"/"•" bullets and **bold**. No HTML is ever injected. */
function RichText({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-medium text-fg">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="my-1.5 space-y-1 ps-4 [list-style:'–_'] marker:text-gold">{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(?:[-•*]|\d+\.)\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line) blocks.push(<p key={`p${blocks.length}`} className="[&:not(:first-child)]:mt-2">{bold(line)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function ProductCard({ p }: { p: ConciergeProduct }) {
  const t = useTranslations("concierge");
  const money = useMoney();
  const { add, pending } = useAddToBag();
  const inStock = p.variants.filter((v) => v.available > 0);
  const [variantId, setVariantId] = useState(inStock[0]?.id ?? p.variants[0]?.id);
  const v = p.variants.find((x) => x.id === variantId) ?? p.variants[0];
  const art = useRef<HTMLDivElement>(null);
  const selectId = useId();
  if (!v) return null;
  return (
    <li className="flex gap-3 border border-line bg-bg/60 p-2.5">
      <Link href={productHref(p.slug)} className="relative block h-20 w-16 shrink-0 overflow-hidden bg-bg-soft" aria-label={`${t("view")} ${p.name}`}>
        <div ref={art} className="absolute inset-0">
          {p.image ? <MediaImage src={p.image.src} alt="" sizes="64px" className={p.image.cutout ? "!object-contain p-1" : "photo-grade"} /> : <ProductArt model={p.model as Model3D} palette={p.palette} animated={false} />}
        </div>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={productHref(p.slug)} className="truncate font-display text-lg leading-tight text-fg hover:text-gold">
          {p.name}
        </Link>
        <p className="truncate text-xs text-muted">{p.subtitle}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
          <span className="text-sm tabular-nums text-fg">{money(v.price)}</span>
          {p.variants.length > 1 ? (
            <>
              <label htmlFor={selectId} className="sr-only">
                {t("size")}
              </label>
              <select
                id={selectId}
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="h-7 max-w-[8.5rem] truncate border border-line bg-bg px-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
              >
                {p.variants.map((x) => (
                  <option key={x.id} value={x.id} disabled={x.available <= 0}>
                    {x.label}
                    {x.available <= 0 ? ` · ${t("soldOut")}` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-xs text-subtle">{v.label}</span>
          )}
          <button
            type="button"
            disabled={pending || v.available <= 0}
            onClick={(e) => add({ variantId: v.id, source: art.current ?? e.currentTarget, item: { name: p.name, label: v.label, model: p.model as Model3D, palette: p.palette, image: p.image }, price: v.price })}
            className="press ms-auto h-7 border border-gold/60 px-2.5 text-[0.625rem] uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-bg disabled:opacity-40"
          >
            {v.available <= 0 ? t("soldOut") : t("addToBag")}
          </button>
        </div>
      </div>
    </li>
  );
}

export function ConciergeClient({ careEmail }: { careEmail: string }) {
  const t = useTranslations("concierge");
  const router = useRouter();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Saved>({ conversationId: null, messages: [], feedback: null });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => {
    const s = load();
    // Restoring a chat from this tab's session storage after mount (it isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s) setState(s);
  }, []);
  useEffect(() => save(state), [state]);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [state.messages, open, reduce]);
  useEffect(() => () => abort.current?.abort(), []);

  const close = useCallback(() => {
    setOpen(false);
    fab.current?.focus();
  }, []);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setState((s) => {
      const msgs = [...s.messages];
      const i = msgs.length - 1;
      if (i >= 0 && msgs[i].role === "assistant") msgs[i] = fn(msgs[i]);
      return { ...s, messages: msgs };
    });

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setStatus(t("thinking"));
    setState((s) => ({ ...s, feedback: null, messages: [...s.messages, { id: uid(), role: "user", text: message }, { id: uid(), role: "assistant", text: "" }] }));
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: state.conversationId ?? undefined, message, page: window.location.pathname }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as ConciergeEvent;
          if (e.type === "start") setState((s) => ({ ...s, conversationId: e.conversationId }));
          else if (e.type === "notice") patchLast((m) => ({ ...m, notice: e.text, mock: true }));
          else if (e.type === "text") {
            setStatus("");
            patchLast((m) => ({ ...m, text: m.text + e.text }));
          } else if (e.type === "products") patchLast((m) => ({ ...m, products: e.items }));
          else if (e.type === "bag") {
            bumpBag();
            router.refresh();
            setStatus(t("bagUpdated", { count: e.bag.count }));
          } else if (e.type === "error") patchLast((m) => ({ ...m, text: e.text, error: true }));
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") patchLast((m) => ({ ...m, text: m.text || t("error"), error: !m.text }));
    } finally {
      setBusy(false);
      setStatus((s) => (s === t("thinking") ? "" : s));
      abort.current = null;
    }
  }

  async function feedback(helpful: boolean) {
    if (!state.conversationId) return;
    setState((s) => ({ ...s, feedback: helpful ? "yes" : "no" }));
    await conciergeFeedback({ conversationId: state.conversationId, helpful }).catch(() => null);
  }

  async function talkToPerson() {
    if (!state.conversationId) {
      setHandoff(t("handoffFallback", { email: careEmail }));
      return;
    }
    const r = await conciergeHandoff({ conversationId: state.conversationId }).catch(() => null);
    setHandoff(r?.ok && r.ticket ? t("handoffDone", { ticket: r.ticket }) : t("handoffFallback", { email: careEmail }));
  }

  function reset() {
    abort.current?.abort();
    setHandoff(null);
    setState({ conversationId: null, messages: [], feedback: null });
    field.current?.focus();
  }

  const answered = state.messages.some((m) => m.role === "assistant" && m.text && !m.error);
  const suggestions = [t("s1"), t("s2"), t("s3"), t("s4")];

  return (
    <>
      <div className="float-above-bar pointer-events-none fixed bottom-5 start-4 z-[60] transition-transform duration-500 ease-luxe md:bottom-8 md:start-8">
        <AnimatePresence>
          {!open && (
            <motion.button
              ref={fab}
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={t("open")}
              className="press group pointer-events-auto flex h-12 items-center gap-2.5 rounded-full border border-gold/50 bg-bg/85 px-4 text-gold shadow-luxe backdrop-blur-md transition-colors hover:border-gold hover:bg-gold hover:text-bg"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.5, ease } }}
              exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.2 } }}
            >
              <Sparkles className="size-4" strokeWidth={1.3} aria-hidden />
              <span className="hidden text-[0.625rem] uppercase tracking-[0.24em] sm:inline">{t("open")}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-[69] bg-black/40 md:hidden"
              aria-hidden
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.25 }}
            />
            <motion.section
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
              className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[88svh] min-h-[60svh] flex-col border-t border-gold/30 bg-bg-elev text-fg shadow-luxe md:inset-x-auto md:bottom-8 md:start-8 md:max-h-[min(42rem,calc(100svh-6rem))] md:min-h-0 md:w-[25rem] md:border"
              initial={reduce ? { opacity: 0 } : { y: "100%", opacity: 0.6 }}
              animate={{ y: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.5, ease } }}
              exit={reduce ? { opacity: 0 } : { y: "100%", opacity: 0, transition: { duration: 0.3 } }}
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
              <header className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-gold/40 text-gold" aria-hidden>
                  <Sparkles className="size-4" strokeWidth={1.3} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="font-display text-xl leading-tight">
                    {t("title")}
                  </h2>
                  <p className="text-xs text-muted">{t("subtitle")}</p>
                </div>
                {state.messages.length > 0 && (
                  <button type="button" onClick={reset} className="press grid size-9 place-items-center text-muted hover:text-gold" aria-label={t("newChat")} title={t("newChat")}>
                    <RotateCcw className="size-4" strokeWidth={1.3} />
                  </button>
                )}
                <button type="button" onClick={close} className="press grid size-9 place-items-center text-muted hover:text-gold" aria-label={t("close")}>
                  <X className="size-4" strokeWidth={1.3} />
                </button>
              </header>

              <div ref={scroller} data-lenis-prevent className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite" aria-busy={busy}>
                {state.messages.length === 0 && (
                  <div>
                    <p className="text-sm leading-relaxed text-muted">{t("intro")}</p>
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <li key={s}>
                          <button type="button" onClick={() => send(s)} className="press rounded-full border border-line-strong px-3 py-1.5 text-xs text-fg transition-colors hover:border-gold hover:text-gold">
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {state.messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <p dir="auto" className="max-w-[85%] whitespace-pre-line bg-gold/15 px-3 py-2 text-sm text-fg">
                        <span className="sr-only">{t("you")}: </span>
                        {m.text}
                      </p>
                    </div>
                  ) : (
                    <div key={m.id} className="space-y-2">
                      {m.notice ? (
                        <p className="flex items-center gap-2 text-[0.6875rem] text-subtle">
                          <span className="border border-line-strong px-1.5 py-0.5 uppercase tracking-[0.18em] text-gold">{t("mock")}</span>
                          <span>{m.notice}</span>
                        </p>
                      ) : null}
                      {m.text ? (
                        <div dir="auto" className={cn("max-w-[92%] text-sm leading-relaxed", m.error ? "text-ember" : "text-fg/90")}>
                          <span className="sr-only">{t("perfumer")}: </span>
                          <RichText text={m.text} />
                        </div>
                      ) : busy ? (
                        <p className="flex items-center gap-2 text-xs text-muted">
                          <span className="inline-flex gap-1" aria-hidden>
                            {[0, 1, 2].map((i) => (
                              <span key={i} className="size-1 rounded-full bg-gold motion-safe:animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                            ))}
                          </span>
                          {t("thinking")}
                        </p>
                      ) : null}
                      {m.products?.length ? (
                        <ul className="space-y-2">
                          {m.products.map((p) => (
                            <ProductCard key={p.id} p={p} />
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ),
                )}
                {answered && !busy && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
                    {state.feedback ? (
                      <span>{t("thanks")}</span>
                    ) : (
                      <>
                        <span>{t("helpful")}</span>
                        <button type="button" onClick={() => feedback(true)} className="press grid size-8 place-items-center border border-line hover:border-gold hover:text-gold" aria-label={t("yes")}>
                          <ThumbsUp className="size-3.5" strokeWidth={1.4} />
                        </button>
                        <button type="button" onClick={() => feedback(false)} className="press grid size-8 place-items-center border border-line hover:border-gold hover:text-gold" aria-label={t("no")}>
                          <ThumbsDown className="size-3.5" strokeWidth={1.4} />
                        </button>
                      </>
                    )}
                    <button type="button" onClick={talkToPerson} className="press ms-auto inline-flex items-center gap-1.5 hover:text-gold">
                      <Headset className="size-3.5" strokeWidth={1.4} aria-hidden /> {t("human")}
                    </button>
                  </div>
                )}
                {handoff ? <p className="border border-gold/30 px-3 py-2 text-xs text-fg">{handoff}</p> : null}
              </div>

              <p className="sr-only" role="status">
                {status}
              </p>

              <form
                className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <div className="flex items-end gap-2 border border-line-strong bg-bg px-3 py-2 focus-within:border-gold">
                  <label htmlFor={`${titleId}-input`} className="sr-only">
                    {t("placeholder")}
                  </label>
                  <textarea
                    id={`${titleId}-input`}
                    ref={field}
                    dir="auto"
                    rows={1}
                    maxLength={1200}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    placeholder={t("placeholder")}
                    className="max-h-28 min-h-6 flex-1 resize-none bg-transparent text-base text-fg outline-none placeholder:text-subtle md:text-sm"
                  />
                  <button type="submit" disabled={busy || !input.trim()} aria-label={t("send")} className="press grid size-8 shrink-0 place-items-center rounded-full bg-gold text-bg transition-opacity disabled:opacity-30">
                    <ArrowUp className="size-4" strokeWidth={1.6} />
                  </button>
                </div>
                <p className="mt-2 text-[0.625rem] leading-snug text-subtle">{t("disclaimer")}</p>
              </form>
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
