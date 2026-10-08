import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { InferenceSession, Tensor } from "onnxruntime-web";

/**
 * Server-side face detection + recognition with the OpenCV Zoo models (Apache-2.0, see models/face/README.md):
 *  - YuNet (face_detection_yunet_2023mar.onnx): 640×640 BGR input, outputs per stride (8/16/32) cls, obj, bbox, kps.
 *  - SFace (face_recognition_sface_2021dec_int8.onnx): 112×112 RGB aligned face → 128-d feature.
 * Runs on onnxruntime-web's WASM backend (no native binaries). Models load once per process.
 * Frames are only held in memory for the duration of a call; nothing here writes images anywhere.
 */

export type Point = [number, number];
export type DetectedFace = { x: number; y: number; w: number; h: number; score: number; landmarks: Point[] };
export type Decoded = { data: Buffer; width: number; height: number };

const INPUT = 640;
const STRIDES = [8, 16, 32] as const;
const SCORE_THRESHOLD = 0.7;
const NMS_IOU = 0.3;
/** Biggest image we decode: phones send ~640px JPEGs; anything larger is downscaled first. */
const MAX_SIDE = 1280;
const MAX_INPUT_PIXELS = 4096 * 4096;

/** ArcFace 5-point template for a 112×112 crop (eye, eye, nose, mouth corner, mouth corner). */
const TEMPLATE: Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

type Models = { ort: typeof import("onnxruntime-web"); yunet: InferenceSession; sface: InferenceSession };
const g = globalThis as unknown as { __moFaceModels?: Promise<Models> };

export function modelDir() {
  return process.env.FACE_MODEL_DIR || path.join(process.cwd(), "models", "face");
}

/** Lazy singleton: the first face request pays ~0.5–1s to load both models, later ones reuse them. */
export function loadModels(): Promise<Models> {
  if (!g.__moFaceModels) {
    g.__moFaceModels = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = 1; // no worker threads in serverless functions
      ort.env.logLevel = "error";
      const opts: InferenceSession.SessionOptions = { logSeverityLevel: 3, executionProviders: ["wasm"] };
      const dir = modelDir();
      const [yunetBytes, sfaceBytes] = await Promise.all([
        fs.readFile(path.join(dir, "face_detection_yunet_2023mar.onnx")),
        fs.readFile(path.join(dir, "face_recognition_sface_2021dec_int8.onnx")),
      ]);
      const yunet = await ort.InferenceSession.create(new Uint8Array(yunetBytes), opts);
      const sface = await ort.InferenceSession.create(new Uint8Array(sfaceBytes), opts);
      return { ort, yunet, sface };
    })().catch((e) => {
      g.__moFaceModels = undefined; // allow a retry on the next request
      throw e;
    });
  }
  return g.__moFaceModels;
}

export class BadImageError extends Error {}

/** Decodes a JPEG/PNG/WebP into packed RGB, honouring EXIF orientation and capping the size. */
export async function decodeImage(input: Buffer): Promise<Decoded> {
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new BadImageError("Unsupported image");
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof BadImageError) throw e;
    throw new BadImageError("That image couldn't be read.");
  }
}

const iou = (a: DetectedFace, b: DetectedFace) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Runs YuNet on a decoded image. The image is letterboxed into 640×640 (top-left aligned, zero padded). */
export async function detectFaces(img: Decoded): Promise<DetectedFace[]> {
  const { ort, yunet } = await loadModels();
  const scale = Math.min(INPUT / img.width, INPUT / img.height);
  const rw = Math.max(1, Math.round(img.width * scale));
  const rh = Math.max(1, Math.round(img.height * scale));
  const resized = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(rw, rh, { fit: "fill" })
    .raw()
    .toBuffer();

  // NCHW, BGR channel order, raw 0..255 values (as cv::dnn::blobFromImage with defaults).
  const plane = INPUT * INPUT;
  const blob = new Float32Array(3 * plane);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const s = (y * rw + x) * 3;
      const d = y * INPUT + x;
      blob[d] = resized[s + 2]; // B
      blob[plane + d] = resized[s + 1]; // G
      blob[2 * plane + d] = resized[s]; // R
    }
  }
  const out = await yunet.run({ input: new ort.Tensor("float32", blob, [1, 3, INPUT, INPUT]) });
  const get = (name: string) => (out[name] as Tensor).data as Float32Array;

  const candidates: DetectedFace[] = [];
  for (const stride of STRIDES) {
    const cols = INPUT / stride;
    const rows = INPUT / stride;
    const cls = get(`cls_${stride}`);
    const obj = get(`obj_${stride}`);
    const bbox = get(`bbox_${stride}`);
    const kps = get(`kps_${stride}`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < SCORE_THRESHOLD) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks: Point[] = [];
        for (let n = 0; n < 5; n++) {
          landmarks.push([((kps[i * 10 + 2 * n] + c) * stride) / scale, ((kps[i * 10 + 2 * n + 1] + r) * stride) / scale]);
        }
        candidates.push({ x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale, score, landmarks });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const f of candidates) {
    if (kept.every((k) => iou(k, f) < NMS_IOU)) kept.push(f);
    if (kept.length >= 20) break;
  }
  return kept;
}

/** Least-squares similarity transform (rotation + uniform scale + translation) mapping src → dst. */
export function similarityTransform(src: Point[], dst: Point[]) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const xs = src[i][0] - sx, ys = src[i][1] - sy;
    const xd = dst[i][0] - dx, yd = dst[i][1] - dy;
    num1 += xs * xd + ys * yd;
    num2 += xs * yd - ys * xd;
    den += xs * xs + ys * ys;
  }
  const a = den ? num1 / den : 1;
  const b = den ? num2 / den : 0;
  // [u, v] = [[a, -b], [b, a]] · [x, y] + [tx, ty]
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

/** Warps the face into the 112×112 ArcFace crop with bilinear sampling. Returns packed RGB. */
export function alignFace(img: Decoded, landmarks: Point[]): Uint8Array {
  const { a, b, tx, ty } = similarityTransform(landmarks, TEMPLATE);
  const det = a * a + b * b;
  const out = new Uint8Array(112 * 112 * 3);
  const { data, width, height } = img;
  for (let v = 0; v < 112; v++) {
    for (let u = 0; u < 112; u++) {
      // Inverse map: [x, y] = M⁻¹([u, v] − t), M⁻¹ = [[a, b], [−b, a]] / det
      const px = u - tx, py = v - ty;
      const x = (a * px + b * py) / det;
      const y = (-b * px + a * py) / det;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const o = (v * 112 + u) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const sample = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : data[(yy * width + xx) * 3 + ch];
        const val =
          sample(x0, y0) * (1 - fx) * (1 - fy) +
          sample(x0 + 1, y0) * fx * (1 - fy) +
          sample(x0, y0 + 1) * (1 - fx) * fy +
          sample(x0 + 1, y0 + 1) * fx * fy;
        out[o + ch] = Math.round(val);
      }
    }
  }
  return out;
}

/** SFace embedding of an aligned crop, L2-normalised (so cosine similarity is a dot product). */
export async function embedAligned(aligned: Uint8Array): Promise<Float32Array> {
  const { ort, sface } = await loadModels();
  const plane = 112 * 112;
  const blob = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    blob[i] = aligned[i * 3]; // R (OpenCV feeds SFace with swapRB=true)
    blob[plane + i] = aligned[i * 3 + 1];
    blob[2 * plane + i] = aligned[i * 3 + 2];
  }
  const out = await sface.run({ data: new ort.Tensor("float32", blob, [1, 3, 112, 112]) });
  const raw = (out[sface.outputNames[0]] as Tensor).data as Float32Array;
  return l2normalize(Float32Array.from(raw));
}

export function l2normalize(v: Float32Array) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
