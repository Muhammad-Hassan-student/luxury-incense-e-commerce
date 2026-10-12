import { auth } from "@/auth";
import { rateLimit } from "@/server/rate-limit";
import { AttachmentError, MAX_ATTACHMENT_BYTES, storeAttachment } from "@/server/support/attachments";

/** Photo attachments for support messages (signed-in customers and staff). Returns { url }. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!(await rateLimit(`support-upload:${session.user.id}`, 20, 3600)).ok) return Response.json({ error: "Too many uploads. Try again later." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) return Response.json({ error: "Photos can be up to 5 MB." }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a photo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No photo received." }, { status: 400 });
  try {
    const url = await storeAttachment(new Uint8Array(await file.arrayBuffer()));
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AttachmentError) return Response.json({ error: e.message }, { status: 415 });
    throw e;
  }
}
