"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

/** Photo attachments for support messages: uploads to /api/support/upload, keeps up to 4 URLs. */
export function AttachmentPicker({ value, onChange, labels }: { value: string[]; onChange: (urls: string[]) => void; labels: { attach: string; hint: string; uploading: string; remove: string } }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    const next = [...value];
    for (const f of Array.from(files).slice(0, 4 - value.length)) {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/support/upload", { method: "POST", body: form }).catch(() => null);
      const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res?.ok && j?.url) next.push(j.url);
      else setError(j?.error ?? "Upload failed");
    }
    onChange(next);
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((u) => (
            <li key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="size-16 border border-line object-cover" />
              <button type="button" aria-label={labels.remove} onClick={() => onChange(value.filter((x) => x !== u))} className="absolute -end-2 -top-2 grid size-6 place-items-center rounded-full border border-line bg-bg text-muted hover:text-fg">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < 4 && (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
          <ImagePlus className="size-4" aria-hidden />
          {busy ? labels.uploading : labels.attach}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      )}
      <p className="text-xs text-subtle">{error ? <span className="text-ember">{error}</span> : labels.hint}</p>
    </div>
  );
}
