import { brand } from "@/config/brand";

// Static, cookie-free page the service worker precaches and shows when a navigation fails offline.
// The server sends English; a tiny inline script swaps in the visitor's language from the NEXT_LOCALE cookie.
export const dynamic = "force-static";

/** [title, body, retry, dir] per store locale (kept here because the page must work with no server). */
const OFFLINE_COPY: Record<string, [string, string, string, "ltr" | "rtl"]> = {
  en: ["You are offline", "The page you asked for isn’t saved on this device. Pages you visited recently still open — reconnect to continue shopping.", "Try again", "ltr"],
  ur: ["آپ آف لائن ہیں", "جو صفحہ آپ نے مانگا وہ اس آلے پر محفوظ نہیں۔ حال ہی میں دیکھے گئے صفحات اب بھی کھلتے ہیں — خریداری جاری رکھنے کے لیے دوبارہ جڑیں۔", "دوبارہ کوشش کریں", "rtl"],
  ar: ["أنت غير متصل بالإنترنت", "الصفحة التي طلبتها غير محفوظة على هذا الجهاز. الصفحات التي زرتها مؤخرًا ما زالت متاحة — أعد الاتصال لمتابعة التسوق.", "أعد المحاولة", "rtl"],
  hi: ["आप ऑफ़लाइन हैं", "आपका माँगा गया पेज इस डिवाइस पर सहेजा नहीं गया है। हाल में देखे गए पेज अब भी खुलते हैं — ख़रीदारी जारी रखने के लिए फिर से कनेक्ट करें।", "फिर से कोशिश करें", "ltr"],
  fr: ["Vous êtes hors ligne", "Cette page n’est pas enregistrée sur cet appareil. Les pages consultées récemment restent accessibles — reconnectez-vous pour poursuivre vos achats.", "Réessayer", "ltr"],
  es: ["Estás sin conexión", "La página que buscas no está guardada en este dispositivo. Las páginas que visitaste hace poco siguen disponibles: vuelve a conectarte para seguir comprando.", "Reintentar", "ltr"],
  de: ["Sie sind offline", "Diese Seite ist auf diesem Gerät nicht gespeichert. Kürzlich besuchte Seiten lassen sich weiterhin öffnen – verbinden Sie sich erneut, um weiter einzukaufen.", "Erneut versuchen", "ltr"],
  tr: ["Çevrimdışısınız", "İstediğiniz sayfa bu cihazda kayıtlı değil. Son ziyaret ettiğiniz sayfalar hâlâ açılıyor — alışverişe devam etmek için yeniden bağlanın.", "Tekrar dene", "ltr"],
  zh: ["您已离线", "您请求的页面未保存在此设备上。最近访问过的页面仍可打开——重新联网即可继续选购。", "重试", "ltr"],
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Offline · ${brand.name}</title>
<style>
  :root { --bg:#0b0a09; --fg:#f3ede4; --muted:#a89d8e; --gold:#c8a46a; --line:rgba(201,183,156,.32); color-scheme: dark light; }
  @media (prefers-color-scheme: light) { :root { --bg:#f3ede4; --fg:#1a1714; --muted:#6b5f50; --gold:#9a7a43; --line:rgba(26,23,20,.24); } }
  * { box-sizing: border-box; }
  html, body { margin:0; min-height:100%; background:var(--bg); color:var(--fg); font-family: Georgia, "Times New Roman", serif; }
  main { min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 16px; text-align:center; gap:18px; }
  .mono { width:72px; height:72px; border:1px solid var(--gold); color:var(--gold); display:grid; place-items:center; font-size:26px; letter-spacing:.12em; border-radius:50%; }
  h1 { font-weight:300; font-size: clamp(30px, 7vw, 46px); margin:8px 0 0; }
  p { color:var(--muted); max-width:30rem; line-height:1.6; margin:0; font-family: system-ui, sans-serif; font-size:15px; }
  /* System fonts only (this page must render with no network). One language is shown, picked by the script below. */
  html[lang="ar"] :is(h1, p, button) { font-family: "Noto Naskh Arabic", "Geeza Pro", "Segoe UI", Tahoma, system-ui, sans-serif; }
  html[lang="ur"] :is(h1, p, button) { font-family: "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", "Noto Naskh Arabic", "Segoe UI", Tahoma, system-ui, sans-serif; line-height: 2.2; }
  html[lang="hi"] :is(h1, p, button) { font-family: "Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", Mangal, system-ui, sans-serif; line-height: 1.8; }
  html[lang="zh"] :is(h1, p, button) { font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans GB", system-ui, sans-serif; }
  html:is([lang="ar"], [lang="ur"], [lang="hi"]) button { letter-spacing: 0; }
  html[lang="zh"] button { letter-spacing: .12em; }
  button { margin-top:10px; background:transparent; color:var(--fg); border:1px solid var(--line); padding:14px 28px; text-transform:uppercase; letter-spacing:.28em; font-size:11px; cursor:pointer; font-family: system-ui, sans-serif; }
  button:hover { border-color:var(--gold); color:var(--gold); }
</style>
</head>
<body>
<main>
  <div class="mono" aria-hidden="true">${brand.monogram}</div>
  <h1 id="t">You are offline</h1>
  <p id="b">The page you asked for isn’t saved on this device. Pages you visited recently still open — reconnect to continue shopping.</p>
  <button id="r" type="button" onclick="location.reload()">Try again</button>
</main>
<script>
(function () {
  var copy = ${JSON.stringify(OFFLINE_COPY)};
  // The visitor's chosen language (cookie), else the first browser language we serve, else English.
  var m = /(?:^|; )NEXT_LOCALE=([a-z]{2})/.exec(document.cookie);
  var code = m && copy[m[1]] ? m[1] : null;
  var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  for (var i = 0; !code && i < prefs.length; i++) {
    var tag = String(prefs[i]).toLowerCase();
    if (/^zh-(hant|tw|hk|mo)/.test(tag)) continue;
    if (copy[tag.slice(0, 2)]) code = tag.slice(0, 2);
  }
  var c = copy[code || "en"];
  var h = document.documentElement;
  h.lang = code || "en";
  h.dir = c[3];
  document.getElementById("t").textContent = c[0];
  document.getElementById("b").textContent = c[1];
  document.getElementById("r").textContent = c[2];
})();
</script>
</body>
</html>`;

export function GET() {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } });
}
