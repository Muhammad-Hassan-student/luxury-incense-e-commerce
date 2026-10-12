import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { BackupButtons, ErrorGroupActions } from "@/components/admin/health-actions";
import { requirePermission } from "@/server/roles";
import { getIntegration } from "@/server/integrations";
import { release } from "@/server/monitoring";
import { cronStatus, databaseStats, errorGroups, healthKpis, integrationStatus, slowRoutes, type ErrorFilter } from "@/server/monitoring/health";
import { param } from "@/lib/admin-queries";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store health" };

const FILTERS: ErrorFilter[] = ["open", "resolved", "ignored", "all"];
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ago = (d: Date | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export default async function HealthPage(props: PageProps<"/admin/health">) {
  const access = await requirePermission("health.view");
  const sp = await props.searchParams;
  const f = param(sp.errors) as ErrorFilter;
  const filter: ErrorFilter = FILTERS.includes(f) ? f : "open";
  const [kpis, groups, slow, crons, services, dbStats, monitoring] = await Promise.all([healthKpis(), errorGroups(filter), slowRoutes(), cronStatus(), integrationStatus(), databaseStats(), getIntegration("monitoring")]);
  const owner = access.role === "OWNER";
  const cloudinary = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-domain").replace(/\/$/, "");

  return (
    <>
      <PageHeader eyebrow="Operations" title="Store health">
        Release <span className="font-mono">{release()}</span> · errors from the server and from shoppers’ browsers, slow pages, scheduled jobs and outside services. Alerts go to{" "}
        {monitoring.alertEmails || "the owners"} (Integrations → Monitoring &amp; backups).
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open error groups" value={<span className={kpis.openErrors ? "text-ember" : undefined}>{kpis.openErrors}</span>} hint={`${kpis.newToday} new in 24h`} />
        <Kpi label="Failed cron runs (24h)" value={<span className={kpis.cronFailures ? "text-ember" : undefined}>{kpis.cronFailures}</span>} />
        <Kpi label="Database" value={mb(dbStats.bytes)} hint={`${dbStats.tables.length} tables`} />
        <Kpi label="Last backup" value={kpis.lastBackup ? ago(kpis.lastBackup.startedAt) : "never"} hint={kpis.lastBackup ? fmtDateTime(kpis.lastBackup.startedAt) : "Runs daily at 02:30 UTC"} />
      </div>

      <Section
        title="Errors"
        actions={
          <nav className="flex flex-wrap gap-3 text-[0.625rem] uppercase tracking-[0.2em]" aria-label="Error filter">
            {FILTERS.map((x) => (
              <Link key={x} href={x === "open" ? "/admin/health" : `/admin/health?errors=${x}`} className={x === filter ? "text-gold" : "text-muted hover:text-fg"} aria-current={x === filter ? "page" : undefined}>
                {x}
              </Link>
            ))}
          </nav>
        }
      >
        {groups.length ? (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-mono text-sm text-fg">{g.message}</p>
                    <p className="mt-1 text-xs text-muted">
                      <Badge tone={g.source === "client" ? "muted" : "ember"}>{g.source}</Badge> <span className="break-all">{g.route ?? "—"}</span> · {g.count}× · first {fmtDateTime(g.firstSeenAt)} · last {fmtDateTime(g.lastSeenAt)} · release {g.release ?? "?"}
                    </p>
                  </div>
                  <ErrorGroupActions id={g.id} status={g.status} />
                </div>
                {g.sampleStack ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-subtle hover:text-fg">Sample stack</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all border border-line bg-bg p-3 text-[0.6875rem] leading-relaxed text-muted">{g.sampleStack}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{filter === "open" ? "No open errors. All quiet." : "Nothing here."}</Empty>
        )}
      </Section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <Section title="Scheduled jobs">
          <Table className="min-w-[520px]">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Last run</Th>
                <Th className="text-right">Took</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {crons.map((c) => (
                <tr key={c.job}>
                  <Td>
                    <span className="font-mono text-xs">{c.job}</span>
                    {c.schedule ? <span className="block text-[0.625rem] text-subtle">{c.schedule} UTC</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{c.lastRunAt ? fmtDateTime(c.lastRunAt) : "never"}</Td>
                  <Td className="text-right tabular-nums text-muted">{c.durationMs != null ? `${(c.durationMs / 1000).toFixed(1)}s` : "—"}</Td>
                  <Td>
                    {c.running ? (
                      <Badge tone="muted">running</Badge>
                    ) : c.ok === false ? (
                      <span title={c.error ?? undefined}>
                        <Badge tone="ember">failed</Badge>
                      </span>
                    ) : c.late ? (
                      <Badge tone="ember">late</Badge>
                    ) : c.ok ? (
                      <Badge tone="gold">ok</Badge>
                    ) : (
                      <Badge tone="muted">no runs</Badge>
                    )}
                    {c.failures7d ? <span className="ms-2 text-[0.625rem] text-subtle">{c.failures7d} fail/7d</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Outside services">
          <ul className="divide-y divide-line">
            {services.map((s) => (
              <li key={s.provider} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{s.label}</p>
                  <p className="text-xs text-muted">
                    ok {ago(s.lastSuccessAt)} · failed {ago(s.lastFailureAt)}
                    {s.state === "failing" && s.lastError ? <span className="block break-words text-ember">{s.lastError}</span> : null}
                  </p>
                </div>
                <Badge tone={s.state === "failing" ? "ember" : s.state === "ok" ? "gold" : "muted"}>{s.state}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <Section title="Slow requests (7 days)">
          {slow.length ? (
            <Table className="min-w-[480px]">
              <thead>
                <tr>
                  <Th>Route</Th>
                  <Th className="text-right">Count</Th>
                  <Th className="text-right">Avg</Th>
                  <Th className="text-right">Max</Th>
                </tr>
              </thead>
              <tbody>
                {slow.map((r) => (
                  <tr key={`${r.route}-${r.source}`}>
                    <Td className="max-w-[16rem] truncate font-mono text-xs">
                      {r.route} <span className="text-subtle">({r.source})</span>
                    </Td>
                    <Td className="text-right tabular-nums">{r.count}</Td>
                    <Td className="text-right tabular-nums">{(r.avgMs / 1000).toFixed(1)}s</Td>
                    <Td className="text-right tabular-nums">{(r.maxMs / 1000).toFixed(1)}s</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No request over {monitoring.slowMs / 1000}s this week.</Empty>
          )}
        </Section>

        <Section title="Largest tables">
          <Table className="min-w-[360px]">
            <thead>
              <tr>
                <Th>Table</Th>
                <Th className="text-right">Rows (approx.)</Th>
                <Th className="text-right">Size</Th>
              </tr>
            </thead>
            <tbody>
              {dbStats.tables.slice(0, 15).map((t) => (
                <tr key={t.name}>
                  <Td className="font-mono text-xs">{t.name}</Td>
                  <Td className="text-right tabular-nums">{t.rows.toLocaleString("en-IN")}</Td>
                  <Td className="text-right tabular-nums text-muted">{mb(t.bytes)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      </div>

      <Section title="Backups" className="mt-8">
        <div className="space-y-4 p-5 text-sm text-muted">
          <p>
            Every day at 02:30 UTC the orders, items, payments, customers (minimal), catalogue and stock, trade, subscriptions, returns, shipments and support tickets are exported as gzipped
            JSON — {monitoring.backupDestination === "off" ? "currently switched off" : cloudinary && monitoring.backupDestination !== "email" ? "uploaded privately to Cloudinary (folder maison-oud/backups)" : "emailed to the owners as an attachment (add Cloudinary keys for larger stores)"}. Sessions, passkeys, face templates, API keys
            and gift card codes are never included.
          </p>
          {owner ? <BackupButtons /> : <p className="text-xs text-subtle">Only owners can download or run backups.</p>}
          <details>
            <summary className="cursor-pointer text-fg">How to restore</summary>
            <ol className="mt-3 list-decimal space-y-1 ps-5">
              <li>Create an empty Postgres database and run <code className="font-mono text-xs">npx prisma migrate deploy</code> against it.</li>
              <li>
                Check the file: <code className="break-all font-mono text-xs">npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/restore-backup.ts maison-oud-backup-….json.gz</code>
              </li>
              <li>
                Insert: run it again with <code className="font-mono text-xs">DATABASE_URL=…new database…</code> and <code className="font-mono text-xs">--apply</code>.
              </li>
              <li>Point the site at the new database. Customers sign in again by email; staff re-enter integration keys; re-issue gift card codes.</li>
            </ol>
          </details>
        </div>
      </Section>

      <Section title="Uptime monitoring" className="mt-8">
        <div className="space-y-2 p-5 text-sm text-muted">
          <p>
            Public health check: <code className="break-all font-mono text-xs text-fg">{site}/api/health</code> — 200 with <code className="font-mono text-xs">{`{"ok":true}`}</code> when the app and database answer,
            503 otherwise.
          </p>
          <p>
            UptimeRobot (free): Add New Monitor → type <em>HTTP(s) – Keyword</em> → URL above → keyword <code className="font-mono text-xs">&quot;ok&quot;:true</code> (alert when not exists) → interval 5
            minutes → add your email / WhatsApp as alert contacts. Better Stack and Pingdom work the same way.
          </p>
        </div>
      </Section>
    </>
  );
}
