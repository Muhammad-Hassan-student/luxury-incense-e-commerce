"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Counts an affiliate link click (`?aff=CODE`). Attribution itself rides on the cookie src/proxy.ts sets;
 * this only feeds the click stats, de-duplicated per device on the server.
 */
export function AffiliateBeacon() {
  const code = useSearchParams().get("aff");
  useEffect(() => {
    if (!code || !/^[a-z0-9]{4,20}$/i.test(code)) return;
    const key = `mo_aff_seen:${code.toUpperCase()}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: the server still de-duplicates.
    }
    void fetch("/api/aff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "click", code, path: location.pathname, referrer: document.referrer || null }),
      keepalive: true,
    }).catch(() => {});
  }, [code]);
  return null;
}
