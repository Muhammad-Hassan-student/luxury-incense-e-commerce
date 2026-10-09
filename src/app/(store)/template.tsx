import { ViewTransition } from "react";

/**
 * Re-mounts on every top-level navigation, so its <ViewTransition> exits with the old page and enters
 * with the new one: a quick fade out, then the new page settles in (classes in globals.css).
 * Browsers without View Transitions get a CSS-only fade on `.page-shell` instead.
 * Nothing here hides content before hydration, so the first paint is never held back.
 */
export default function StoreTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      <div className="page-shell">{children}</div>
    </ViewTransition>
  );
}
