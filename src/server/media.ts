import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, integrations } from "@/env";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export type SniffedType = { kind: "IMAGE" | "VIDEO"; ext: string };

/**
 * Identifies a file by its leading bytes rather than its name or browser-supplied type.
 * SVG is deliberately not accepted (it can carry script).
 */
export function sniff(buf: Uint8Array): SniffedType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: "IMAGE", ext: "jpg" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { kind: "IMAGE", ext: "png" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { kind: "IMAGE", ext: "webp" };
  if (ascii(0, "GIF8")) return { kind: "IMAGE", ext: "gif" };
  if (ascii(4, "ftypavif") || ascii(4, "ftypavis")) return { kind: "IMAGE", ext: "avif" };
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: "VIDEO", ext: "webm" };
  if (ascii(4, "ftyp")) return { kind: "VIDEO", ext: ascii(8, "qt  ") ? "mov" : "mp4" };
  return null;
}

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

/** Local disk storage, used when Cloudinary isn't configured. Fine for dev and single-server hosting. */
export async function saveLocal(buf: Uint8Array, type: SniffedType, folder: "products" | "categories" | "content") {
  const dir = path.join(UPLOAD_ROOT, folder);
  await mkdir(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${type.ext}`;
  await writeFile(path.join(dir, name), buf);
  return `/uploads/${folder}/${name}`;
}

/** Removes a locally stored file. Ignores anything that isn't ours (remote URLs, odd paths). */
export async function deleteLocal(url: string | null | undefined) {
  if (!url?.startsWith("/uploads/")) return;
  const full = path.normalize(path.join(process.cwd(), "public", url));
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) return;
  await unlink(full).catch(() => {});
}

export const storageMode = () => (integrations.cloudinary && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET ? "cloudinary" : "local");

/** Signed parameters for a direct browser → Cloudinary upload (the file never touches our server). */
export function cloudinarySignature(folder: string) {
  if (storageMode() !== "cloudinary") return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    apiKey: env.CLOUDINARY_API_KEY!,
    folder,
    timestamp,
    signature: createHash("sha1").update(toSign).digest("hex"),
  };
}

/** Accept pasted links only over https (or our own /uploads paths). */
export function isAcceptableUrl(url: string) {
  if (url.startsWith("/uploads/")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Cloudinary can render a still from any video by swapping the extension. */
export function cloudinaryPoster(videoUrl: string) {
  return videoUrl.includes("res.cloudinary.com") ? videoUrl.replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg") : null;
}
