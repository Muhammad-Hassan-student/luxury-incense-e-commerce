/*
 * The service worker, as source text. It is served by src/app/sw.js/route.ts (versioned with the deployment) and the
 * routing rules below are evaluated in scripts/platform-check.ts, so what is tested is exactly what browsers run.
 *
 * Rules (the important part — Face ID / passkey sign-in and every personal page must never come from a cache):
 *  - Only same-origin GETs are touched; everything else goes straight to the network.
 *  - Never cached: /api/**, sign-in, account, admin, checkout, cart, order / pay / track / trade / visit links,
 *    unsubscribe, the SW and manifest themselves, RSC/data requests and anything with a query token.
 *  - Cache-first: /_next/static (content-hashed, immutable), our icons, and product images (uploads, /_next/image,
 *    res.cloudinary.com), each cache trimmed to a fixed size.
 *  - Network-first with offline fallback: catalogue pages (home, shop, product, collections, journal, ritual, gifts).
 *    A page is only stored when the server marked it `x-sw-cache: public` (the proxy does this for visitors without
 *    a session), so HTML rendered for a signed-in customer never lands in Cache Storage.
 *  - Any other navigation is network-only; offline it shows /offline.html (precached, static, no user data).
 */

/** Pure routing rules (plain ES2017, no references outside the functions). */
export const SW_ROUTES_JS = String.raw`
var NEVER_CACHE_PREFIXES = [
  "/api/", "/admin", "/account", "/checkout", "/cart", "/signin", "/signout", "/order/", "/pay/", "/track",
  "/trade", "/visit/", "/unsubscribe", "/sw.js", "/manifest.webmanifest", "/_next/data/", "/__nextjs", "/_next/webpack-hmr"
];
var CATALOGUE_PREFIXES = ["/shop", "/product/", "/collections", "/journal", "/ritual", "/gifts"];
var IMAGE_HOSTS = ["res.cloudinary.com"];
var SECRET_PARAMS = ["token", "t", "code", "key", "secret", "signature", "sig", "email", "callbackUrl"];

function startsWithAny(path, list) {
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.charAt(p.length - 1) === "/") {
      if (path.indexOf(p) === 0) return true;
    } else if (path === p || path.indexOf(p + "/") === 0) {
      return true;
    }
  }
  return false;
}

/**
 * req: { url, method, mode, destination, rsc, origin }
 * returns { strategy: "network" | "network-only-fallback" | "static" | "image" | "page", cache?: string }
 *  - network: let the browser handle it (no respondWith)
 *  - network-only-fallback: navigation that is never stored; offline page when the network fails
 */
function swRoute(req) {
  var url;
  try { url = new URL(req.url, req.origin); } catch (e) { return { strategy: "network" }; }
  if ((req.method || "GET").toUpperCase() !== "GET") return { strategy: "network" };
  var sameOrigin = url.origin === req.origin;
  if (!sameOrigin) {
    if (IMAGE_HOSTS.indexOf(url.hostname) !== -1 && (req.destination === "image" || /\.(png|jpe?g|webp|avif|gif)$/i.test(url.pathname))) return { strategy: "image", cache: "images" };
    return { strategy: "network" };
  }
  var path = url.pathname;
  var isNav = req.mode === "navigate";
  // RSC payloads and prefetches carry per-user data in the same URL as the HTML: never cached.
  if (req.rsc || url.searchParams.has("_rsc")) return { strategy: "network" };
  for (var i = 0; i < SECRET_PARAMS.length; i++) {
    if (url.searchParams.has(SECRET_PARAMS[i])) return isNav ? { strategy: "network-only-fallback" } : { strategy: "network" };
  }
  if (startsWithAny(path, NEVER_CACHE_PREFIXES)) return isNav ? { strategy: "network-only-fallback" } : { strategy: "network" };
  if (path.indexOf("/_next/static/") === 0) return { strategy: "static", cache: "static" };
  if (path.indexOf("/_next/image") === 0 || path.indexOf("/uploads/") === 0) return { strategy: "image", cache: "images" };
  if (path.indexOf("/icons/") === 0 || path === "/offline.html" || path === "/favicon.ico") return { strategy: "static", cache: "static" };
  if (isNav) {
    if (path === "/" || startsWithAny(path, CATALOGUE_PREFIXES)) return { strategy: "page", cache: "pages" };
    return { strategy: "network-only-fallback" };
  }
  return { strategy: "network" };
}

/** Only successful, same-origin pages the server explicitly marked as public may be stored. */
function swCacheablePage(res) {
  if (!res || !res.ok || res.status !== 200) return false;
  if (res.type && res.type !== "basic") return false;
  var h = res.headers;
  var get = function (k) { return h && typeof h.get === "function" ? h.get(k) : h ? h[k] : null; };
  if (get("x-sw-cache") !== "public") return false;
  var ct = get("content-type") || "";
  return ct.indexOf("text/html") === 0;
}
`;

/** Max entries kept per cache (oldest dropped first). */
const LIMITS = { static: 400, images: 160, pages: 40 };

/** The whole service worker for a given build version. */
export function serviceWorkerSource(version: string, opts: { dev?: boolean } = {}) {
  return `/* Maison Oud service worker — ${version} */
"use strict";
${SW_ROUTES_JS}
var VERSION = ${JSON.stringify(version)};
var DEV = ${opts.dev ? "true" : "false"};
// Static assets are content-hashed, so their cache survives deploys (an open tab can still lazy-load old chunks);
// pages are versioned so a deploy never serves stale HTML offline.
var CACHES = { static: "mo-static-v1", images: "mo-images-v1", pages: "mo-pages-" + VERSION };
var LIMITS = ${JSON.stringify(LIMITS)};
var OFFLINE_URL = "/offline.html";
var PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHES.static).then(function (c) { return c.addAll(PRECACHE); }).catch(function () {}).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      var keep = [CACHES.static, CACHES.images, CACHES.pages];
      return Promise.all(keys.filter(function (k) { return k.indexOf("mo-") === 0 && keep.indexOf(k) === -1; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  // Signing out (or in) drops stored pages so nothing from one visitor is ever shown to another.
  if (data.type === "CLEAR_PAGES") event.waitUntil(caches.delete(CACHES.pages));
  if (data.type === "SKIP_WAITING") self.skipWaiting();
});

function trim(name, max) {
  return caches.open(name).then(function (c) {
    return c.keys().then(function (keys) {
      if (keys.length <= max) return;
      return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return c.delete(k); }));
    });
  });
}

function cacheFirst(request, name) {
  return caches.open(CACHES[name]).then(function (c) {
    return c.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        // Opaque cross-origin images are fine to keep (status 0) — they are public product photos.
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          c.put(request, copy).then(function () { return trim(CACHES[name], LIMITS[name]); }).catch(function () {});
        }
        return res;
      });
    });
  });
}

function offline() {
  return caches.match(OFFLINE_URL).then(function (r) {
    return r || new Response("<h1>You are offline</h1>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  });
}

function networkFirstPage(request) {
  return fetch(request).then(function (res) {
    if (swCacheablePage(res)) {
      var copy = res.clone();
      caches.open(CACHES.pages).then(function (c) { return c.put(request, copy); }).then(function () { return trim(CACHES.pages, LIMITS.pages); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.open(CACHES.pages).then(function (c) { return c.match(request); }).then(function (hit) { return hit || offline(); });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var route = swRoute({ url: req.url, method: req.method, mode: req.mode, destination: req.destination, rsc: req.headers.get("RSC") === "1" || req.headers.has("Next-Router-State-Tree"), origin: self.location.origin });
  if (route.strategy === "network") return;
  if (route.strategy === "network-only-fallback") {
    event.respondWith(fetch(req).catch(offline));
    return;
  }
  if (DEV) {
    // Dev chunks are not content-hashed: never cache them, only provide the offline page.
    if (route.strategy === "page") event.respondWith(fetch(req).catch(offline));
    return;
  }
  if (route.strategy === "static" || route.strategy === "image") {
    event.respondWith(cacheFirst(req, route.cache).catch(function () { return fetch(req); }));
    return;
  }
  if (route.strategy === "page") event.respondWith(networkFirstPage(req));
});

// ───────────── Web push ─────────────
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Maison Oud", body: event.data ? event.data.text() : "" }; }
  var url = typeof data.url === "string" && data.url.charAt(0) === "/" && data.url.charAt(1) !== "/" ? data.url : "/";
  var options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: url },
    lang: data.lang || undefined,
    dir: data.dir || "auto"
  };
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(data.title || "Maison Oud", options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).pathname === url && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

// The browser rotated the subscription: register the new one (cookies identify the customer).
self.addEventListener("pushsubscriptionchange", function (event) {
  var old = event.oldSubscription;
  var key = old && old.options ? old.options.applicationServerKey : null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then(function (sub) {
      return fetch("/api/push/subscription", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), replaces: old ? old.endpoint : null }) });
    }).catch(function () {})
  );
});
`;
}
