"use client";

import { useRef, useState, useTransition } from "react";
import { setCategoryHero } from "@/actions/admin-media";
import { uploadMedia } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import { notify, useAdminAction } from "./use-admin-action";

/** One banner slot (image or video) for a category. */
export function CategoryBannerSlot({ categoryId, field, url, canEdit }: { categoryId: string; field: "heroImage" | "heroVideo"; url: string | null; canEdit: boolean }) {
  const isVideo = field === "heroVideo";
  const { pending, run } = useAdminAction();
  const [pct, setPct] = useState<number | null>(null);
  const [, startUpload] = useTransition();
  const [link, setLink] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const upload = (file: File) =>
    startUpload(async () => {
      try {
        setPct(0);
        const up = await uploadMedia(file, "categories", setPct);
        if ((up.type === "VIDEO") !== isVideo) {
          notify.error(isVideo ? "That’s an image — use the image slot." : "That’s a video — use the video slot.");
          return;
        }
        const res = await setCategoryHero({ categoryId, field, url: up.url });
        if (res.ok) notify.success(res.message ?? "Saved");
        else notify.error(res.error);
      } catch (e) {
        notify.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setPct(null);
      }
    });

  return (
    <div className="space-y-3">
      <p className="eyebrow !text-muted">{isVideo ? "Banner video" : "Banner image"}</p>
      <div className="relative aspect-video overflow-hidden border border-line bg-bg-soft">
        {url ? (
          isVideo ? (
            <video src={url} muted loop playsInline autoPlay className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview, any origin
            <img src={url} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <span className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-subtle">
            {isVideo ? "None — falls back to the image, then the ambient animation" : "None — the ambient animation is shown"}
          </span>
        )}
        {pct !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-bg/60">
            <div className="h-1 bg-gold transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending || pct !== null} onClick={() => input.current?.click()}>
              {url ? "Replace" : "Upload"}
            </Button>
            {url && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCategoryHero({ categoryId, field, url: null }))}>
                Remove
              </Button>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setCategoryHero({ categoryId, field, url: link }), { onSuccess: () => setLink("") });
            }}
          >
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="or paste https://…" aria-label={`${isVideo ? "Video" : "Image"} link`} className="min-w-0 flex-1 border-b border-line-strong bg-transparent py-1 text-xs focus:border-gold focus:outline-none" />
            <button disabled={!link || pending} className="text-[0.625rem] uppercase tracking-[0.2em] text-gold disabled:opacity-40">
              Use link
            </button>
          </form>
          <input
            ref={input}
            type="file"
            hidden
            accept={isVideo ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,image/avif"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
