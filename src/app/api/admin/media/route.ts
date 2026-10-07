import { can, getAccess } from "@/server/roles";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, saveLocal, sniff, storageMode } from "@/server/media";

const FOLDERS = ["products", "categories", "content"] as const;

/**
 * Local upload endpoint (used when Cloudinary isn't configured).
 * A route handler rather than a server action so large videos aren't capped at 1MB.
 */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!can(access, "catalog.edit") && !can(access, "content.edit")) return Response.json({ error: "Not allowed" }, { status: 403 });
  if (storageMode() !== "local") return Response.json({ error: "Uploads go directly to Cloudinary" }, { status: 400 });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_VIDEO_BYTES + 1024 * 1024) return Response.json({ error: "File is too large (60MB max for video)" }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a file upload" }, { status: 400 });
  }
  const file = form.get("file");
  const folder = FOLDERS.find((f) => f === form.get("folder")) ?? "products";
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No file received" }, { status: 400 });

  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniff(buf.subarray(0, 32));
  if (!type) return Response.json({ error: "Use JPG, PNG, WebP, AVIF or GIF for images, MP4/MOV/WebM for video" }, { status: 415 });
  const max = type.kind === "IMAGE" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (buf.byteLength > max) return Response.json({ error: `File is too large (${max / 1024 / 1024}MB max)` }, { status: 413 });

  const url = await saveLocal(buf, type, folder);
  return Response.json({ url, type: type.kind });
}
