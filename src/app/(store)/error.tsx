"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="container-luxe grid min-h-[60svh] place-items-center text-center">
      <div>
        <p className="eyebrow">Something flickered</p>
        <h1 className="display mt-6 text-5xl md:text-7xl">We couldn’t load this page</h1>
        <p className="mx-auto mt-6 max-w-sm text-muted">Please try again. If it keeps happening, write to us and quote {error.digest ?? "this page"}.</p>
        <Button className="mt-10" onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
