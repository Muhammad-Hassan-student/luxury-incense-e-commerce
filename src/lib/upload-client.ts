"use client";

import { getUploadSignature } from "@/actions/admin-media";

export type UploadFolder = "products" | "categories" | "content";
export type Uploaded = { url: string; type: "IMAGE" | "VIDEO" };

/** Our endpoint returns { error: string }; Cloudinary returns { error: { message } }. */
function errorMessage(json: unknown): string | undefined {
  const err = (json as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  const message = (err as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

function send(url: string, body: FormData, onProgress?: (pct: number) => void) {
  return new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new Error(errorMessage(json) ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(body);
  });
}

/** Uploads to Cloudinary when configured (signed, direct from the browser), otherwise to our own /uploads. */
export async function uploadMedia(file: File | Blob, folder: UploadFolder, onProgress?: (pct: number) => void): Promise<Uploaded> {
  const sig = await getUploadSignature(folder);
  const body = new FormData();
  body.append("file", file);
  if (sig) {
    body.append("api_key", sig.apiKey);
    body.append("timestamp", String(sig.timestamp));
    body.append("signature", sig.signature);
    body.append("folder", sig.folder);
    const res = (await send(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, body, onProgress)) as { secure_url: string; resource_type: string };
    return { url: res.secure_url, type: res.resource_type === "video" ? "VIDEO" : "IMAGE" };
  }
  body.append("folder", folder);
  return (await send("/api/admin/media", body, onProgress)) as Uploaded;
}

/** Grabs a frame ~1s into a video as a WebP poster, so videos never show a blank box before playing. */
export function posterFromVideo(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const src = URL.createObjectURL(file);
    const done = (b: Blob | null) => {
      URL.revokeObjectURL(src);
      resolve(b);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / (video.videoWidth || 1600));
      canvas.width = Math.round((video.videoWidth || 1600) * scale);
      canvas.height = Math.round((video.videoHeight || 900) * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => done(b), "image/webp", 0.85);
    };
    video.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
  });
}
