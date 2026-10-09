"use client";

/**
 * Quick view lives in the URL (`?view=<slug>`) so it can be shared and the back button closes it.
 * Next's router picks up native pushState/replaceState, so useSearchParams() re-renders without a server trip.
 */
export const QUICK_VIEW_PARAM = "view";

let openedHere = false;

export function openQuickView(slug: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(QUICK_VIEW_PARAM, slug);
  openedHere = true;
  window.history.pushState(null, "", url);
}

export function closeQuickView() {
  if (openedHere) {
    openedHere = false;
    window.history.back();
    return;
  }
  // Arrived on a shared link: drop the parameter without leaving the page.
  const url = new URL(window.location.href);
  url.searchParams.delete(QUICK_VIEW_PARAM);
  window.history.replaceState(null, "", url);
}

/** Following a link out of the dialog: forget the history entry we pushed rather than walking back over it. */
export function forgetQuickView() {
  openedHere = false;
}
