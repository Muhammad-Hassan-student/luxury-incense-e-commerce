import { brand } from "@/config/brand";
import { getVisitByToken, getVisitSettings } from "@/server/visits";
import { purposeLabel } from "@/server/visit-schedule";

export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 text escaping + 75-octet line folding. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export async function GET(req: Request, ctx: RouteContext<"/api/visits/[token]/ics">) {
  const { token } = await ctx.params;
  const v = await getVisitByToken(token);
  if (!v) return new Response("Not found", { status: 404 });
  const s = await getVisitSettings();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const end = new Date(v.startsAt.getTime() + v.durationMins * 60_000);
  const status = v.status === "CONFIRMED" || v.status === "CHECKED_IN" || v.status === "COMPLETED" ? "CONFIRMED" : v.status === "REQUESTED" ? "TENTATIVE" : "CANCELLED";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${brand.name}//Atelier visits//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${v.reference}@${new URL(site).hostname}`,
    `DTSTAMP:${stamp(v.updatedAt)}`,
    `DTSTART:${stamp(v.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${brand.name} atelier visit · ${v.reference}`)}`,
    `LOCATION:${esc(s.address.replace(/\n/g, ", "))}`,
    `DESCRIPTION:${esc(`${purposeLabel(v.purpose)} for ${v.groupSize}. ${s.directions}\n\nManage your visit: ${site}/visit/${v.token}`)}`,
    `URL:${site}/visit/${v.token}`,
    `STATUS:${status}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`${brand.name} atelier visit`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${v.reference}.ics"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
