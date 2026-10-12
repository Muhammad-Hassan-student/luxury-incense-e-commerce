import { brand } from "@/config/brand";

// Static, cookie-free page the service worker precaches and shows when a navigation fails offline.
export const dynamic = "force-static";

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
  p[lang="ar"] { font-family: "Noto Naskh Arabic", system-ui, sans-serif; }
  button { margin-top:10px; background:transparent; color:var(--fg); border:1px solid var(--line); padding:14px 28px; text-transform:uppercase; letter-spacing:.28em; font-size:11px; cursor:pointer; font-family: system-ui, sans-serif; }
  button:hover { border-color:var(--gold); color:var(--gold); }
</style>
</head>
<body>
<main>
  <div class="mono" aria-hidden="true">${brand.monogram}</div>
  <h1>You are offline</h1>
  <p>The page you asked for isn’t saved on this device. Pages you visited recently still open — reconnect to continue shopping.</p>
  <p lang="ar" dir="rtl">أنت غير متصل بالإنترنت. الصفحات التي زرتها مؤخرًا ما زالت متاحة — أعد الاتصال لمتابعة التسوق.</p>
  <button type="button" onclick="location.reload()">Try again · أعد المحاولة</button>
</main>
</body>
</html>`;

export function GET() {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } });
}
