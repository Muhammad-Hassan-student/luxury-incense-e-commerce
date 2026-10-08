import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { SECOND_STEP } from "./config";
import { decryptEmbedding, encryptEmbedding } from "./crypto";
import { BadImageError, alignFace, cosine, decodeImage, detectFaces, embedAligned, l2normalize } from "./face-engine";
import { SecurityError } from "./tickets";

/**
 * Camera face check. Frames arrive as base64 JPEGs, are decoded in memory, and are dropped when the request ends.
 * Only a 128-number embedding is ever kept (encrypted). Liveness is deliberately modest: it stops photos held still
 * and replayed frames, not a skilled spoof — which is why the face check only ever runs AFTER step 1.
 */

const MAX_PROBE_BYTES = 200_000;
const MAX_FRAME_BYTES = 900_000;
export const FRAME_COUNT = 3;

/** Camera problems (no face, too small, several faces): shown to the user, never counted as a wrong try. */
export class CameraProblem extends SecurityError {
  constructor(message: string) {
    super(message, 422, { camera: true });
  }
}

/** Liveness failures: counted as a wrong try by the caller. */
export class LivenessFailure extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function parseFrame(input: unknown, maxBytes = MAX_FRAME_BYTES): Buffer {
  if (typeof input !== "string") throw new SecurityError("Missing camera frame.", 400);
  const b64 = input.startsWith("data:") ? input.slice(input.indexOf(",") + 1) : input;
  if (b64.length > Math.ceil((maxBytes * 4) / 3) + 8) throw new SecurityError("That camera frame is too large.", 413);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 500) throw new SecurityError("That camera frame is empty.", 400);
  return buf;
}

async function readFace(buf: Buffer) {
  let img;
  try {
    img = await decodeImage(buf);
  } catch (e) {
    if (e instanceof BadImageError) throw new CameraProblem("That camera frame couldn’t be read. Please try again.");
    throw e;
  }
  const faces = await detectFaces(img);
  return { img, faces };
}

/** Live guidance: where the face is, how big. No recognition, nothing stored. */
export async function probeFrame(frame: unknown) {
  const { img, faces } = await readFace(parseFrame(frame, MAX_PROBE_BYTES));
  const f = faces[0];
  if (!f) return { faces: 0, size: 0, x: 0, y: 0 };
  return {
    faces: faces.length,
    size: round(f.w / img.width),
    x: round((f.x + f.w / 2) / img.width - 0.5),
    y: round((f.y + f.h / 2) / img.height - 0.5),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export type FrameAnalysis = { embeddings: Float32Array[]; sizes: number[] };

/**
 * Detects + embeds each frame and runs the liveness rules: exactly one face per frame, frames not byte-identical,
 * all frames the same person, the last face ≥ 1.08× the first.
 */
export async function analyzeFrames(rawFrames: unknown): Promise<FrameAnalysis> {
  if (!Array.isArray(rawFrames) || rawFrames.length !== FRAME_COUNT) throw new SecurityError(`Send exactly ${FRAME_COUNT} camera frames.`, 400);
  const frames = rawFrames.map((f) => parseFrame(f));
  const hashes = frames.map((f) => createHash("sha256").update(f).digest("hex"));
  if (new Set(hashes).size !== hashes.length) throw new LivenessFailure("identical_frames");

  const embeddings: Float32Array[] = [];
  const sizes: number[] = [];
  for (const buf of frames) {
    const { img, faces } = await readFace(buf);
    if (faces.length === 0) throw new CameraProblem("We couldn’t see your face. Look at the camera and try again.");
    if (faces.length > 1) throw new CameraProblem("We can see more than one face. Make sure only you are in the picture.");
    const size = faces[0].w / img.width;
    if (size < SECOND_STEP.minFaceSize) throw new CameraProblem("Your face is too far away. Move a little closer.");
    sizes.push(size);
    embeddings.push(await embedAligned(alignFace(img, faces[0].landmarks)));
  }
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      if (cosine(embeddings[i], embeddings[j]) < SECOND_STEP.faceThreshold) throw new LivenessFailure("different_people");
    }
  }
  if (sizes[sizes.length - 1] < sizes[0] * SECOND_STEP.minZoom) throw new LivenessFailure("no_zoom");
  return { embeddings, sizes };
}

/** One template per saved face: the normalised mean of the enrollment frames. */
export function templateOf(embeddings: Float32Array[]) {
  const mean = new Float32Array(embeddings[0].length);
  for (const e of embeddings) for (let i = 0; i < mean.length; i++) mean[i] += e[i] / embeddings.length;
  return l2normalize(mean);
}

/** Saves a face (max 3 per user, enforced under a row lock so parallel requests can't exceed it). */
export async function saveFace(userId: string, embeddings: Float32Array[], label: string) {
  const embedding = encryptEmbedding(templateOf(embeddings), userId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "SecuritySettings" WHERE "userId" = ${userId} FOR UPDATE`;
    const count = await tx.faceTemplate.count({ where: { userId } });
    if (count >= SECOND_STEP.maxFaces) throw new SecurityError(`You can save up to ${SECOND_STEP.maxFaces} faces. Remove one first.`, 409);
    return tx.faceTemplate.create({ data: { userId, label: label.trim().slice(0, 40) || `Face ${count + 1}`, embedding } });
  });
}

/** EVERY frame must match a saved face (cosine ≥ 0.42). Returns the best-matching template id, or null. */
export async function matchFaces(userId: string, embeddings: Float32Array[]) {
  const rows = await db.faceTemplate.findMany({ where: { userId }, select: { id: true, embedding: true } });
  const templates = rows.flatMap((r) => {
    try {
      return [{ id: r.id, vec: decryptEmbedding(r.embedding, userId) }];
    } catch {
      return []; // undecryptable (e.g. key rotated): never matches
    }
  });
  if (!templates.length) return { matched: null as string | null, scores: [] as number[] };
  let bestId: string | null = null;
  let bestScore = -1;
  const scores: number[] = [];
  for (const e of embeddings) {
    let frameBest = -1;
    for (const t of templates) {
      const s = cosine(e, t.vec);
      if (s > frameBest) frameBest = s;
      if (s > bestScore) {
        bestScore = s;
        bestId = t.id;
      }
    }
    scores.push(round(frameBest));
  }
  const ok = scores.every((s) => s >= SECOND_STEP.faceThreshold);
  return { matched: ok ? bestId : null, scores };
}
