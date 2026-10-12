// Generates the PWA icons in public/icons from the brand monogram (an SVG drawn here) with sharp.
// Run: node scripts/generate-pwa-icons.mjs   (re-run after a rebrand; commit the PNGs)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "icons");
const BG = "#0b0a09";
const GOLD = "#c8a46a";
const MONOGRAM = "MO";

/** scale: share of the canvas the ring may use (maskable icons keep everything inside the 80% safe zone). */
function svg({ size, scale, background = true, color = GOLD, ring = true }) {
  const c = size / 2;
  const r = (size * scale) / 2;
  const font = r * 0.78;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<defs><radialGradient id="g" cx="50%" cy="62%" r="70%"><stop offset="0" stop-color="#2a1f17"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` : ""}
  ${ring ? `<circle cx="${c}" cy="${c}" r="${r - size * 0.012}" fill="none" stroke="${color}" stroke-width="${Math.max(1.5, size * 0.012)}"/>` : ""}
  <circle cx="${c}" cy="${c}" r="${r * 0.86}" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="${Math.max(1, size * 0.004)}"/>
  <text x="${c}" y="${c + font * 0.34}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, 'Times New Roman', serif" font-size="${font}" font-weight="300" letter-spacing="${font * 0.08}" fill="${color}">${MONOGRAM}</text>
</svg>`);
}

const jobs = [
  ["icon-192.png", { size: 192, scale: 0.86 }],
  ["icon-512.png", { size: 512, scale: 0.86 }],
  ["maskable-192.png", { size: 192, scale: 0.62 }],
  ["maskable-512.png", { size: 512, scale: 0.62 }],
  ["apple-touch-icon.png", { size: 180, scale: 0.8 }],
  // Android status-bar badge: white on transparent (only the alpha channel is used).
  ["badge-96.png", { size: 96, scale: 0.92, background: false, color: "#ffffff" }],
];

await mkdir(OUT, { recursive: true });
for (const [name, opts] of jobs) {
  await sharp(svg(opts)).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`✓ public/icons/${name}`);
}
