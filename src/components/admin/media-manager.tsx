"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Film, ImagePlus, RefreshCcw, Scissors, Trash2 } from "lucide-react";
import { addProductMedia, deleteMedia, reorderMedia, reprepareMedia, setMediaDisplay, updateMediaAlt } from "@/actions/admin-media";
import { ProductPhoto, photoMode } from "@/components/product/product-photo";
import { posterFromVideo, uploadMedia } from "@/lib/upload-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { notify, useAdminAction } from "./use-admin-action";

export type AdminMedia = { id: string; type: "IMAGE" | "VIDEO"; url: string; poster: string | null; alt: string; cutoutUrl: string | null; display: "AUTO" | "CUTOUT" | "PHOTO" };
type Pending = { key: string; name: string; pct: number };

export function MediaManager({ productId, media, palette, canEdit, storage }: { productId: string; media: AdminMedia[]; palette: string[]; canEdit: boolean; storage: "cloudinary" | "local" }) {
  const { pending, run } = useAdminAction();
  const [uploads, setUploads] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [, startUpload] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [linkType, setLinkType] = useState<"IMAGE" | "VIDEO">("IMAGE");

  const handleFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
      const progress = (pct: number) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct } : x)));
      startUpload(async () => {
        try {
          const up = await uploadMedia(file, "products", progress);
          let poster: string | undefined;
          if (up.type === "VIDEO") {
            const frame = await posterFromVideo(file);
            if (frame) poster = (await uploadMedia(frame, "products")).url;
          }
          const res = await addProductMedia({ productId, type: up.type, url: up.url, poster, alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") });
          if (res.ok) notify.success(res.message ?? "Uploaded");
          else notify.error(res.error);
        } catch (e) {
          notify.error(e instanceof Error ? e.message : "Upload failed");
        } finally {
          setUploads((u) => u.filter((x) => x.key !== key));
        }
      });
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const ids = media.map((m) => m.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => reorderMedia(productId, ids));
  };

  return (
    <div className="space-y-6">
      {media.length === 0 && uploads.length === 0 && (
        <p className="text-sm text-muted">No photos or videos yet — the storefront shows the procedural illustration and 3D model. Add media to show real photography; the 3D view stays available on the product page.</p>
      )}

      {(media.length > 0 || uploads.length > 0) && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m, i) => (
            <li key={m.id} className="border border-line bg-bg">
              <div className="group relative aspect-[4/5] overflow-hidden bg-bg-elev" title="Store preview">
                {m.type === "VIDEO" ? (
                  <video src={m.url} poster={m.poster ?? undefined} muted loop playsInline preload="metadata" className="photo-grade h-full w-full object-cover" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                ) : (
                  <ProductPhoto item={m} palette={palette} sizes="240px" />
                )}
                <span className="absolute start-2 top-2 bg-bg/80 px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.2em] text-muted">
                  {i === 0 ? "Cover" : `${i + 1}`} {m.type === "VIDEO" && <Film className="ms-1 inline size-3" aria-label="video" />}
                </span>
                {m.type === "IMAGE" && (
                  <span className={cn("absolute end-2 top-2 flex items-center gap-1 bg-bg/80 px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.2em]", photoMode(m) === "cutout" ? "text-gold" : "text-muted")}>
                    {photoMode(m) === "cutout" ? <><Scissors className="size-3" aria-hidden /> Cutout</> : "Framed photo"}
                  </span>
                )}
              </div>
              <div className="space-y-2 p-3">
                <input
                  defaultValue={m.alt}
                  disabled={!canEdit}
                  aria-label="Description (alt text)"
                  onBlur={(e) => e.target.value.trim() !== m.alt && run(() => updateMediaAlt(m.id, e.target.value))}
                  className="w-full border-b border-line bg-transparent py-1 text-xs focus:border-gold focus:outline-none"
                />
                {canEdit && m.type === "IMAGE" && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.display}
                      disabled={pending}
                      aria-label="How this photo shows on the store"
                      onChange={(e) => run(() => setMediaDisplay({ id: m.id, display: e.target.value as AdminMedia["display"] }))}
                      className="flex-1 py-1 text-xs"
                    >
                      <option value="AUTO" className="bg-bg">Auto</option>
                      <option value="CUTOUT" className="bg-bg" disabled={!m.cutoutUrl}>Cutout{m.cutoutUrl ? "" : " (not available)"}</option>
                      <option value="PHOTO" className="bg-bg">Full photo</option>
                    </Select>
                    <button type="button" disabled={pending} onClick={() => run(() => reprepareMedia(m.id))} aria-label="Re-prepare (remove background again)" title="Re-prepare" className="p-1 text-muted hover:text-gold disabled:opacity-30">
                      <RefreshCcw className="size-3.5" />
                    </button>
                  </div>
                )}
                {canEdit && (
                  <div className="flex items-center justify-between text-muted">
                    <div className="flex gap-1">
                      <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="Move earlier" className="p-1 hover:text-gold disabled:opacity-30">
                        <ArrowLeft className="size-3.5 rtl:rotate-180" />
                      </button>
                      <button type="button" disabled={pending || i === media.length - 1} onClick={() => move(i, 1)} aria-label="Move later" className="p-1 hover:text-gold disabled:opacity-30">
                        <ArrowRight className="size-3.5 rtl:rotate-180" />
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => confirm("Remove this from the product?") && run(() => deleteMedia(m.id))}
                      aria-label="Remove"
                      className="p-1 hover:text-ember"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.key} className="flex aspect-[4/5] flex-col justify-end border border-dashed border-line-strong p-3">
              <p className="truncate text-xs text-muted">{u.name}</p>
              <div className="mt-2 h-px w-full bg-line-strong">
                <div className="h-px bg-gold transition-[width]" style={{ width: `${u.pct}%` }} />
              </div>
              <p className="mt-1 text-[0.625rem] tabular-nums text-subtle">{u.pct < 100 ? `${u.pct}%` : "Processing…"}</p>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={cn("flex cursor-pointer flex-col items-center gap-2 border border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-gold bg-gold/5" : "border-line-strong hover:border-gold")}
          >
            <ImagePlus className="size-5 text-gold" strokeWidth={1.2} />
            <p className="text-sm">Drop photos or videos here, or click to choose</p>
            <p className="text-xs text-subtle">JPG, PNG, WebP, AVIF up to 10MB · MP4, MOV, WebM up to 60MB · the first item is the cover</p>
            <p className="max-w-md text-xs text-subtle">Tip: shoot on a plain light background (or upload a transparent PNG) and the background is removed automatically, so the product floats on the store like the rest of the collection.</p>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/quicktime,video/webm"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addProductMedia({ productId, type: linkType, url: link, alt: "" }), { onSuccess: () => setLink("") });
            }}
          >
            <label className="min-w-64 flex-1">
              <span className="eyebrow !text-muted">Or add by link</span>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="mt-1 w-full border-b border-line-strong bg-transparent py-2 text-sm focus:border-gold focus:outline-none" />
            </label>
            <Select value={linkType} onChange={(e) => setLinkType(e.target.value as "IMAGE" | "VIDEO")} className="w-28" aria-label="Media type">
              <option value="IMAGE" className="bg-bg">Photo</option>
              <option value="VIDEO" className="bg-bg">Video</option>
            </Select>
            <Button type="submit" size="sm" variant="outline" disabled={pending || !link}>
              Add
            </Button>
          </form>

          <p className="text-xs text-subtle">
            {storage === "cloudinary"
              ? "Files upload straight to Cloudinary and are served from its CDN."
              : "Files are saved in public/uploads on this server. Fine for development; set the CLOUDINARY_* keys before going live so media survives redeploys."}
          </p>
        </>
      )}
    </div>
  );
}
