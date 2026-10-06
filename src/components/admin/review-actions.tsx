"use client";

import { useState } from "react";
import { approveReview, deleteReview } from "@/actions/admin-reviews";
import { Button } from "@/components/ui/button";
import { useAdminAction } from "./use-admin-action";

export function ReviewActions({ id, approved }: { id: string; approved: boolean }) {
  const { pending, run } = useAdminAction();
  const [confirm, setConfirm] = useState(false);

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Confirm delete">
        <span className="text-sm text-muted">Delete permanently?</span>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteReview({ id }))}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
          Keep
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      {!approved ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => approveReview({ id }))}>
          Approve
        </Button>
      ) : null}
      <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirm(true)}>
        Delete
      </Button>
    </div>
  );
}
