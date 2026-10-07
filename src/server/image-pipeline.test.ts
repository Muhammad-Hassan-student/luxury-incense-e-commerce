import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyseProductImage } from "./image-pipeline";

/** A product shot: dark jar with a WHITE label, on a white sweep with a soft grey floor shadow. */
const studioShot = () =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
      <rect width="800" height="1000" fill="#f7f6f4"/>
      <ellipse cx="400" cy="860" rx="230" ry="26" fill="#dcdad6"/>
      <rect x="250" y="300" width="300" height="560" rx="30" fill="#2a2420"/>
      <rect x="290" y="480" width="220" height="160" fill="#ffffff"/>
      <rect x="370" y="250" width="60" height="60" fill="#c8a46a"/>
    </svg>`),
  )
    .png()
    .toBuffer();

const alphaAt = async (buf: Buffer, fx: number, fy: number) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.round(fx * (info.width - 1));
  const y = Math.round(fy * (info.height - 1));
  return data[(y * info.width + x) * 4 + 3];
};

// sharp work is fast alone (<0.5s) but can exceed the 5s default on a loaded machine.
describe("analyseProductImage", { timeout: 30_000 }, () => {
  it("cuts a plain-background product shot out cleanly", async () => {
    const r = await analyseProductImage(await studioShot());
    expect(r.reason).toBe("plain-background");
    expect(r.cutout).not.toBeNull();
    expect(r.edgeColor).toBe("#f7f6f4");
    expect([r.width, r.height]).toEqual([800, 1000]);
    // Corners are gone, the jar body is solid.
    expect(await alphaAt(r.cutout!, 0, 0)).toBe(0);
    expect(await alphaAt(r.cutout!, 0.5, 0.75)).toBe(255);
  });

  it("keeps white areas inside the product (they aren't connected to the background)", async () => {
    const r = await analyseProductImage(await studioShot());
    const { data, info } = await sharp(r.cutout!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Find the white label: a fully opaque, near-white pixel must exist.
    let whiteOpaque = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * 4;
      if (data[o + 3] === 255 && data[o] > 240 && data[o + 1] > 240 && data[o + 2] > 240) whiteOpaque++;
    }
    expect(whiteOpaque).toBeGreaterThan(1000);
  });

  it("turns the photo's floor shadow into a real translucent shadow", async () => {
    const r = await analyseProductImage(await studioShot());
    const { data, info } = await sharp(r.cutout!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Scan the bottom rows outside the jar for shadow pixels.
    let shadow = 0;
    let greyPaint = 0;
    for (let y = Math.round(info.height * 0.93); y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 4;
        const a = data[o + 3];
        if (a > 0 && a < 200 && data[o] < 40) shadow++;
        if (a > 200 && data[o] > 150) greyPaint++;
      }
    }
    expect(shadow).toBeGreaterThan(500);
    expect(greyPaint).toBe(0);
  });

  it("treats a sweep's natural falloff as background, not as a grey band", async () => {
    const sweep = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
        <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9e7e3"/></linearGradient></defs>
        <rect width="800" height="1000" fill="url(#s)"/>
        <rect x="300" y="300" width="200" height="500" rx="20" fill="#5a3a26"/>
      </svg>`),
    )
      .jpeg({ quality: 90 })
      .toBuffer();
    const r = await analyseProductImage(sweep);
    expect(r.reason).toBe("plain-background");
    const { data, info } = await sharp(r.cutout!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Everything outside the product's columns must be (almost) fully transparent, top to bottom.
    let visible = 0;
    for (let y = 0; y < info.height; y++) {
      for (const x of [0, 1, info.width - 2, info.width - 1]) if (data[(y * info.width + x) * 4 + 3] > 12) visible++;
    }
    expect(visible).toBe(0);
  });

  it("leaves busy backgrounds as photos", async () => {
    const busy = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
        <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#1d3b2a"/><stop offset="0.5" stop-color="#c76b2c"/><stop offset="1" stop-color="#2a4d7a"/></linearGradient></defs>
        <rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="300" r="120" fill="#eee"/>
      </svg>`),
    )
      .png()
      .toBuffer();
    const r = await analyseProductImage(busy);
    expect(r.reason).toBe("busy-background");
    expect(r.cutout).toBeNull();
  });

  it("uses transparent PNGs as they are (trimmed)", async () => {
    const png = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><circle cx="250" cy="250" r="100" fill="#8c6a43"/></svg>`),
    )
      .png()
      .toBuffer();
    const r = await analyseProductImage(png);
    expect(r.reason).toBe("transparent");
    const m = await sharp(r.cutout!).metadata();
    expect(m.width).toBeLessThan(260); // trimmed close to the 200px circle (+ padding)
  });

  it("refuses when the 'background' would swallow almost everything", async () => {
    const blank = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const r = await analyseProductImage(blank);
    expect(r.cutout).toBeNull();
    expect(r.reason).toBe("subject-too-small");
  });
});
