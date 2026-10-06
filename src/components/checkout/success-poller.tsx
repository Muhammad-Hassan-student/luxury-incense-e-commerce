"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While the webhook is landing, refresh the confirmation page every 2s (for up to a minute). */
export function SuccessPoller() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if (++n > 30) return clearInterval(id);
      router.refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
