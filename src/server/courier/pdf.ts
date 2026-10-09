/*
 * A tiny PDF writer (no dependencies) for shipping labels and pickup manifests: pages of text, lines,
 * filled boxes and Code 128 barcodes in the standard Helvetica/Courier fonts. ASCII only — anything
 * else is transliterated (₹ → Rs.) so the output works with the built-in WinAnsi fonts.
 */

type Op = string;

export class PdfDoc {
  private pages: { w: number; h: number; ops: Op[] }[] = [];
  private cur: { w: number; h: number; ops: Op[] } | null = null;

  page(w: number, h: number) {
    this.cur = { w, h, ops: [] };
    this.pages.push(this.cur);
    return this;
  }

  private get p() {
    if (!this.cur) throw new Error("No page");
    return this.cur;
  }

  /** Text with its baseline at y (from the top of the page). */
  text(x: number, y: number, s: string, size = 10, font: "R" | "B" | "M" = "R", gray = 0) {
    const f = font === "B" ? "F2" : font === "M" ? "F3" : "F1";
    this.p.ops.push(`BT ${gray} g /${f} ${size} Tf ${n(x)} ${n(this.p.h - y)} Td (${esc(s)}) Tj ET`);
    return this;
  }

  /** Wraps text to a width (approximate Helvetica metrics). Returns the y after the last line. */
  para(x: number, y: number, s: string, width: number, size = 10, font: "R" | "B" = "R", leading = 1.25) {
    const maxChars = Math.max(8, Math.floor(width / (size * (font === "B" ? 0.56 : 0.52))));
    let line = "";
    let yy = y;
    for (const word of ascii(s).split(/\s+/).filter(Boolean)) {
      if ((line + " " + word).trim().length > maxChars && line) {
        this.text(x, yy, line, size, font);
        yy += size * leading;
        line = word;
      } else line = (line + " " + word).trim();
    }
    if (line) {
      this.text(x, yy, line, size, font);
      yy += size * leading;
    }
    return yy;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.8) {
    this.p.ops.push(`${n(width)} w 0 G ${n(x1)} ${n(this.p.h - y1)} m ${n(x2)} ${n(this.p.h - y2)} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: number; stroke?: boolean; width?: number } = {}) {
    const parts: string[] = [];
    if (opts.fill != null) parts.push(`${opts.fill} g ${n(x)} ${n(this.p.h - y - h)} ${n(w)} ${n(h)} re f`);
    if (opts.stroke !== false && opts.fill == null) parts.push(`${n(opts.width ?? 0.8)} w 0 G ${n(x)} ${n(this.p.h - y - h)} ${n(w)} ${n(h)} re S`);
    this.p.ops.push(parts.join(" "));
    return this;
  }

  /** Code 128 (set B) barcode, `height` tall, scaled to `width`. */
  barcode(x: number, y: number, value: string, width: number, height: number) {
    const modules = code128Modules(ascii(value));
    const total = modules.reduce((s, m) => s + m, 0);
    const unit = width / total;
    let cx = x;
    const bars: string[] = ["0 g"];
    modules.forEach((m, i) => {
      if (i % 2 === 0) bars.push(`${n(cx)} ${n(this.p.h - y - height)} ${n(m * unit)} ${n(height)} re`);
      cx += m * unit;
    });
    bars.push("f");
    this.p.ops.push(bars.join(" "));
    return this;
  }

  toBuffer(): Buffer {
    // Object number = index + 1. Object 2 (the page tree) is filled in once the pages exist.
    const objs: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    ];
    const kids: number[] = [];
    for (const pg of this.pages) {
      const stream = pg.ops.join("\n");
      objs.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      const contentNo = objs.length;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pg.w)} ${n(pg.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentNo} 0 R >>`);
      kids.push(objs.length);
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }

  get pageCount() {
    return this.pages.length;
  }
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Printable ASCII only. */
export function ascii(s: string) {
  return s
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}
const esc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// ─────────────────────────────── Code 128 ───────────────────────────────

/** Bar/space widths for symbols 0–106 (106 = stop, which has a 7th element). */
export const CODE128 = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 " +
  "232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 " +
  "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

/** Module widths (bar, space, bar, …) including quiet zones' absence; Start B, data, checksum, stop. */
export function code128Modules(value: string): number[] {
  const codes = [104];
  for (const ch of value) {
    const c = ch.charCodeAt(0) - 32;
    if (c < 0 || c > 95) throw new Error("Code 128 B supports printable ASCII only");
    codes.push(c);
  }
  let sum = 104;
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.flatMap((c) => [...CODE128[c]].map(Number));
}
