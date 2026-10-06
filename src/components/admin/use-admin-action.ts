"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/admin-shared";

export const ADMIN_TOASTER = "admin";

export const notify = {
  success: (msg: string) => toast.success(msg, { toasterId: ADMIN_TOASTER }),
  error: (msg: string) => toast.error(msg, { toasterId: ADMIN_TOASTER }),
};

/**
 * Wraps a server action call in a transition and turns its result into a toast.
 * Returns the result so callers can reset forms or navigate on success.
 */
export function useAdminAction() {
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<ActionResult>, opts: { success?: string; onSuccess?: (r: Extract<ActionResult, { ok: true }>) => void } = {}) {
    startTransition(async () => {
      try {
        const res = await call();
        if (res.ok) {
          const msg = res.message ?? opts.success;
          if (msg) notify.success(msg);
          opts.onSuccess?.(res);
        } else {
          notify.error(res.error);
        }
      } catch (e) {
        // Next's navigation errors (redirect / forbidden) must propagate.
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Something went wrong. Please try again.");
      }
    });
  }

  return { pending, run };
}
