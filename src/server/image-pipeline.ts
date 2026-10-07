import sharp from "sharp";

/**
 * "Studio cutout" for product photos, so real photography sits on the storefront the same way the
 * procedural art does (floating on the theme, no box behind it).
 *
 * - Photos that already have transparency are trimmed and used as they are.
 * - Photos on a plain background (white sweep, grey paper…) have that background removed — only the
 *   part connected to the image border, so a white label or wax inside the product survives.
 * - Anything else (lifestyle shots, busy backgrounds) is left as a photo and framed by the storefront.
 */

export type ImageAnalysis = {
  width: number;
  height: number;
  /** Average border colour as #rrggbb */
  edgeColor: string;
  /** Present when a clean cutout was possible */
  cutout: Buffer | null;
  reason: "transparent" | "plain-background" | "busy-background" | "subject-too-small" | "subject-fills-frame";
};

const WORK_SIZE = 1600;
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export async function analyseProductImage(input: Buffer): Promise<ImageAnalysis> {
  const base = sharp(input, { failOn: "none" }).rotate(); // honour EXIF orientation
  const meta = await base.metadata();
  const { data, info } = await base
    .clone()
    .resize({ width: WORK_SIZE, height: WORK_SIZE, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const width = meta.autoOrient?.width ?? meta.width ?? w;
  const height = meta.autoOrient?.height ?? meta.height ?? h;

  // ── Border statistics ──
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) border.push((y * w + x) * 4);
    }
  }
  const median = (k: number) => {
    const vals = border.map((i) => data[i + k]).sort((a, b) => a - b);
    return vals[vals.length >> 1];
  };
  const bg = [median(0), median(1), median(2)] as const;
  const edgeColor = hex(...bg);
  const dist = (i: number) => {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // ── Already transparent (a cutout PNG/WebP) ──
  let clear = 0;
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 16) clear++;
  if (clear / n > 0.03) {
    return { width, height, edgeColor, cutout: await finalise(data, w, h), reason: "transparent" };
  }

  // ── Plain background? Most of the border must sit close to its median colour. ──
  const near = border.filter((i) => dist(i) < 26).length / border.length;
  if (near < 0.9) return { width, height, edgeColor, cutout: null, reason: "busy-background" };

  // ── Flood fill the background from the border ──
  const bgLum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  const lumOf = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const limit = () => 46;
  // Studio sweeps fall off naturally (lighter at the top, darker near the floor). How much darker the
  // border gets tells us what still counts as "just background" before something reads as shadow.
  const borderLums = border.map(lumOf).sort((a, b) => a - b);
  const sweepFalloff = Math.max(0, bgLum - borderLums[Math.floor(borderLums.length * 0.03)]);
  const shadowStart = Math.max(10, sweepFalloff + 6);
  const chromaOf = (i: number) => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
  // Neutral (grey/white) and never as dark as a product body: sweep highlights, falloff or shadow.
  const isNeutralBackdrop = (i: number) => chromaOf(i) < 16 && lumOf(i) >= bgLum * 0.55;
  /** 0 within the sweep's own falloff, rising smoothly to 0.6 for deep contact shadows. */
  const shadowStrength = (i: number) => Math.min(0.6, Math.max(0, ((bgLum - shadowStart - lumOf(i)) / bgLum) * 1.8));
  const passable = (i: number) => dist(i) < limit() || isNeutralBackdrop(i);
  const isBg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of border) {
    const p = i >> 2;
    if (!isBg[p] && passable(i)) {
      isBg[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of neighbours) {
      if (q < 0 || isBg[q]) continue;
      const i = q * 4;
      if (passable(i)) {
        isBg[q] = 1;
        queue[tail++] = q;
      }
    }
  }

  // ── Alpha + colour decontamination ──
  const out = Buffer.from(data);
  let solid = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (!isBg[p]) {
      solid++;
      continue;
    }
    const lim = limit();
    // Neutral backdrop pixels are sweep highlight/falloff (→ fully clear) or shadow (→ black at an opacity
    // matching how much light it took). Never kept as grey paint, and no rim at the fringe.
    if (isNeutralBackdrop(i)) {
      out[i] = out[i + 1] = out[i + 2] = 0;
      out[i + 3] = Math.round(shadowStrength(i) * 255);
      continue;
    }
    const a = smoothstep(lim * 0.3, lim, dist(i));
    out[i + 3] = Math.round(a * 255);
    if (a > 0.02 && a < 1) {
      // Remove the background's contribution so edges don't keep a white/grey halo.
      for (let k = 0; k < 3; k++) out[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - (1 - a) * bg[k]) / a)));
    }
  }
  const coverage = solid / n;
  if (coverage < 0.03) return { width, height, edgeColor, cutout: null, reason: "subject-too-small" };
  if (coverage > 0.97) return { width, height, edgeColor, cutout: null, reason: "subject-fills-frame" };

  return { width, height, edgeColor, cutout: await finalise(out, w, h), reason: "plain-background" };
}

/** Feather the alpha edge, trim to the subject with breathing room, encode as WebP with alpha. */
async function finalise(rgba: Buffer, w: number, h: number) {
  const alpha = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = rgba[p * 4 + 3];
  // extractChannel: libvips may promote single-channel input to sRGB, which would misalign the alpha bytes.
  const feathered = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(0.6).extractChannel(0).raw().toBuffer();

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.min(rgba[(y * w + x) * 4 + 3], feathered[y * w + x]);
      rgba[(y * w + x) * 4 + 3] = a;
      if (a > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(w - 1, maxX + pad);
  const bottom = Math.min(h - 1, maxY + pad);
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .webp({ quality: 90, alphaQuality: 95, effort: 5 })
    .toBuffer();
}
