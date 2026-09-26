/* Offline copy of Ori's Political Guide.

   The guide is two self-contained pages, so an offline copy is just those two pages and their
   icons. The rule is network first: online, a reader always gets the version on the site, and the
   saved copy is refreshed with it. The saved copy is used only when the network fails, or has not
   answered within a few seconds - and even then the fresh copy is still fetched and saved for the
   next visit. Nothing here talks to any server but this site's own.

   Cloudflare serves the Hebrew page at /he and redirects /he.html there, so every spelling of a
   page is saved under one key. A redirected response cannot be handed to a navigation (Safari
   refuses it), so it is copied into a plain one first. */

const CACHE = "ori-guide-offline-1";
const ASSETS = [
  "/favicon.png", "/favicon.ico", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
  "/icon-maskable-512.png", "/manifest.webmanifest", "/manifest-he.webmanifest"
];
const PAGES = ["/", "/he"];
const SLOW_NETWORK_MS = 4000;

function pageKey(url) {
  const p = url.pathname;
  if (p === "/" || p === "/index.html") return "/";
  if (p === "/he" || p === "/he/" || p === "/he.html") return "/he";
  return null;
}

/* Both editions are saved at install, but the second is a few megabytes fetched in the background,
   and a phone can go offline before it lands. So every online visit also fills in whichever edition
   is missing, and an edition that is still missing offline gets a plain explanation instead of the
   browser's raw fetch error - which is what the language button produced in V179. */
async function fillMissing(cache) {
  for (const path of PAGES) {
    if (await cache.match(path)) continue;
    try {
      const res = await fetch(new Request(path, {cache: "reload"}));
      if (res.ok) await cache.put(path, await plain(res));
    } catch (e) { /* offline again - the next visit tries */ }
  }
}

function notSaved(key) {
  const he = key === "/he";
  const html = he
    ? '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>המדריך הפוליטי של אורי</title>'
      + '<body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;padding:32px 20px;line-height:1.55;max-width:560px;margin:0 auto">'
      + '<h1 style="font-size:22px">הגרסה העברית עוד לא נשמרה במכשיר הזה</h1>'
      + '<p>היא נשמרת בפעם הראשונה שפותחים אותה כשיש אינטרנט. אחרי זה היא תעבוד גם בלי חיבור.</p>'
      + '<p><a href="/" style="color:#2f6fed">חזרה למדריך באנגלית</a></p></body></html>'
    : '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ori\'s Political Guide</title>'
      + '<body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;padding:32px 20px;line-height:1.55;max-width:560px;margin:0 auto">'
      + '<h1 style="font-size:22px">The English edition is not saved on this device yet</h1>'
      + '<p>It is saved the first time it is opened with an internet connection. After that it works offline too.</p>'
      + '<p><a href="/he" style="color:#2f6fed">Back to the Hebrew guide</a></p></body></html>';
  return new Response(html, {headers: {"Content-Type": "text/html; charset=utf-8"}});
}

async function plain(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), {status: res.status, statusText: res.statusText, headers: res.headers});
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of [...PAGES, ...ASSETS]) {
      try {
        const res = await fetch(new Request(path, {cache: "reload"}));
        if (res.ok) await cache.put(path, await plain(res));
      } catch (e) { /* one missing file must not stop the rest being saved */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("ori-guide-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const key = req.mode === "navigate" ? pageKey(url) : null;
  if (key) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(key);
      const fresh = fetch(req).then(async res => {
        if (!res.ok) return saved || res;
        const copy = await plain(res);
        await cache.put(key, copy.clone());
        return copy;
      });
      event.waitUntil(fresh.then(() => fillMissing(cache)).catch(() => {}));
      if (!saved) return fresh.catch(() => notSaved(key));
      return Promise.race([
        fresh.catch(() => saved),
        new Promise(resolve => setTimeout(() => resolve(saved), SLOW_NETWORK_MS))
      ]);
    })());
    return;
  }

  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then(hit => hit || fetch(req)));
  }
});
