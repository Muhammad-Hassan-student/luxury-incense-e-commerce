"use client";

import { useRouter } from "next/navigation";
import { Download, HardDriveUpload } from "lucide-react";
import { runBackupNowAction, setErrorStatusAction } from "@/actions/admin-health";
import { Button } from "@/components/ui/button";
import { useAdminAction } from "./use-admin-action";

export function ErrorGroupActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const set = (s: "open" | "resolved" | "ignored") => run(() => setErrorStatusAction({ ids: [id], status: s }), { onSuccess: () => router.refresh() });
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "resolved" ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => set("resolved")}>
          Resolve
        </Button>
      ) : null}
      {status !== "ignored" ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => set("ignored")}>
          Ignore
        </Button>
      ) : null}
      {status !== "open" ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => set("open")}>
          Reopen
        </Button>
      ) : null}
    </div>
  );
}

export function BackupButtons() {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild size="sm">
        <a href="/api/admin/backup" download>
          <Download className="size-4" aria-hidden /> Download backup now
        </a>
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => runBackupNowAction(), { onSuccess: () => router.refresh() })}>
        <HardDriveUpload className="size-4" aria-hidden /> {pending ? "Backing up…" : "Run daily backup now"}
      </Button>
    </div>
  );
}
