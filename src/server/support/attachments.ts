import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { sniff, storageMode } from "../media";

/** Support attachments: photos only (JPG/PNG/WebP/GIF/AVIF, sniffed by content), 5 MB each. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export class AttachmentError extends Error {}

export async function storeAttachment(buf: Uint8Array): Promise<string> {
  if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError("Photos can be up to 5 MB.");
  const type = sniff(buf.subarray(0, 32));
  if (!type || type.kind !== "IMAGE") throw new AttachmentError("Attach a photo (JPG, PNG, WebP, GIF or AVIF).");
  const name = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
  if (storageMode() === "cloudinary") {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "maison-oud/support";
    const signature = createHash("sha1").update(`folder=${folder}&public_id=${name}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`).digest("hex");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)]), `${name}.${type.ext}`);
    form.append("api_key", env.CLOUDINARY_API_KEY!);
    form.append("timestamp", String(timestamp));
    form.append("folder", folder);
    form.append("public_id", name);
    form.append("signature", signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new AttachmentError("The photo couldn’t be uploaded. Please try again.");
    return ((await res.json()) as { secure_url: string }).secure_url;
  }
  // Local disk (dev / single server). Names are random, so links can't be guessed.
  const dir = path.join(process.cwd(), "public", "uploads", "support");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.${type.ext}`), buf);
  return `/uploads/support/${name}.${type.ext}`;
}
