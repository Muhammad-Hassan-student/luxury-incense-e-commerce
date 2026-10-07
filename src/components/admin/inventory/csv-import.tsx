"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Empty, Table, Td, Th } from "@/components/admin/ui";
import { notify } from "@/components/admin/use-admin-action";

type Value = number | string | null;
type Plan = {
  columns: string[];
  rows: { line: number; sku: string; product: string; changes: { field: string; from: Value; to: Value }[] }[];
  unchanged: number;
  total: number;
  errors: { line: number; sku?: string; message: string }[];
};
type ImportResponse = { plan?: Plan; error?: string; applied?: boolean; updated?: number; stockMoves?: number };

const MAX = 2 * 1024 * 1024;

function show(field: string, v: Value) {
  if (v === null) return "—";
  if (field === "costPrice" && typeof v === "number") return `₹${(v / 100).toFixed(2)}`;
  return String(v);
}

const plural = (n: number | undefined, word: string) => `${n ?? 0} ${word}${n === 1 ? "" : "s"}`;

/** Upload → dry-run preview with diffs and errors → apply (all or nothing). */
export function CsvImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, start] = useTransition();

  async function call(apply: boolean, text: string): Promise<ImportResponse> {
    try {
      const res = await fetch("/api/admin/import/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: text, apply }) });
      const body = (await res.json().catch(() => ({}))) as ImportResponse;
      if (!res.ok && !body.error) body.error = `Request failed (${res.status})`;
      return body;
    } catch {
      return { error: "Network error. Please try again." };
    }
  }

  function preview(file: File) {
    if (file.size > MAX) {
      notify.error("File is larger than 2 MB.");
      return;
    }
    start(async () => {
      const text = await file.text();
      setCsv(text);
      setName(file.name);
      const r = await call(false, text);
      if (r.error) notify.error(r.error);
      setPlan(r.plan ?? null);
    });
  }

  function apply() {
    if (!csv) return;
    start(async () => {
      const r = await call(true, csv);
      if (r.plan) setPlan(r.plan);
      if (r.error) {
        notify.error(r.error);
        return;
      }
      notify.success(`Updated ${plural(r.updated, "variant")} (${plural(r.stockMoves, "stock adjustment")})`);
      setCsv(null);
      setPlan(null);
      setName("");
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  const canApply = Boolean(plan && csv && !plan.errors.length && plan.rows.length);

  return (
    <div className="space-y-6 pb-5">
      <div className="flex flex-wrap items-end gap-4 px-5 pt-5">
        <label className="block min-w-64 flex-1">
          <span className="eyebrow !text-muted">CSV file</span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) preview(f);
            }}
            className="mt-2 block w-full text-sm text-muted file:mr-4 file:border file:border-line-strong file:bg-transparent file:px-4 file:py-2 file:text-[0.6875rem] file:uppercase file:tracking-[0.2em] file:text-fg hover:file:border-gold"
          />
        </label>
        <Button type="button" size="sm" disabled={!canApply || pending} onClick={apply}>
          {pending ? "Working…" : plan?.rows.length ? `Apply ${plural(plan.rows.length, "change")}` : "Apply"}
        </Button>
      </div>

      {plan ? (
        <div className="space-y-6" aria-live="polite">
          <p className="px-5 text-sm text-muted">
            <span className="text-fg">{name}</span>: {plural(plan.total, "row")} · columns {plan.columns.join(", ") || "—"} · <span className="text-gold">{plan.rows.length} to change</span> · {plan.unchanged} unchanged ·{" "}
            <span className={plan.errors.length ? "text-ember" : undefined}>{plural(plan.errors.length, "error")}</span>
            {plan.errors.length ? ". Fix them and re-upload; nothing is applied while errors remain." : ". This is a preview; nothing has been saved yet."}
          </p>

          {plan.errors.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  <Th>SKU</Th>
                  <Th>Problem</Th>
                </tr>
              </thead>
              <tbody>
                {plan.errors.map((e, i) => (
                  <tr key={i}>
                    <Td className="tabular-nums text-muted">{e.line || "—"}</Td>
                    <Td className="font-mono text-xs">{e.sku ?? "—"}</Td>
                    <Td className="text-ember">{e.message}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}

          {plan.rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  <Th>Variant</Th>
                  <Th>Changes</Th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.sku}>
                    <Td className="tabular-nums text-muted">{r.line}</Td>
                    <Td>
                      {r.product} <span className="font-mono text-xs text-subtle">{r.sku}</span>
                    </Td>
                    <Td>
                      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        {r.changes.map((c) => (
                          <li key={c.field}>
                            <Badge tone="muted" className="mr-2">
                              {c.field}
                            </Badge>
                            <span className="text-subtle line-through">{show(c.field, c.from)}</span> → <span className="text-gold">{show(c.field, c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : !plan.errors.length ? (
            <Empty>Everything in the file already matches. Nothing to change.</Empty>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
