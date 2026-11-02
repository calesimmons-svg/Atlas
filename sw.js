// Atlas OFP service worker
// Opens instantly from the saved copy (works offline and on bad Wi-Fi), then
// checks GitHub in the background. A new upload shows up the next time you open
// the app. Bump CACHE when you upload new files.
const CACHE = 'atlas-ofp-v4.7';
const NET_TIMEOUT = 4000;   // ms to wait for the network when nothing is saved yet

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './wx-deviation.png',
  './emergency-descent.png',
  './pdf.min.mjs',          // PDF reader for Upload OFP (works offline)
  './pdf.worker.min.mjs',
];

// Only keep genuine copies of our own files — never a Wi-Fi login page or redirect
const goodCopy = res => res && res.ok && res.type === 'basic' && !res.redirected;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(ASSETS.map(url =>
        fetch(url, { cache: 'no-cache' })
          .then(res => { if (goodCopy(res)) return cache.put(url, res); })
          .catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Carry over anything the new cache couldn't download, then drop old caches
    const fresh = await caches.open(CACHE);
    for (const key of await caches.keys()) {
      if (key === CACHE) continue;
      const old = await caches.open(key);
      for (const req of await old.keys()) {
        if (!(await fresh.match(req))) await fresh.put(req, await old.match(req));
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// Fetch by plain URL (a page-open request can't be re-sent with new options)
async function refresh(cache, url, key) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (goodCopy(res)) await cache.put(key, res.clone());
    return res;
  } catch { return null; }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Opening the app (any URL in our folder, with or without #/?): use the saved page
  const isPage = req.mode === 'navigate';
  const key = isPage ? './index.html' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(key, { ignoreSearch: true });
    const update = refresh(cache, isPage ? './index.html' : req.url, key);
    if (saved) {
      event.waitUntil(update);        // update quietly for next time
      return saved;                    // open instantly
    }
    // Nothing saved yet: try the network, but don't hang forever
    try {
      const res = await withTimeout(update, NET_TIMEOUT);
      if (res) return res;
    } catch {}
    const any = await caches.match(key, { ignoreSearch: true });
    return any || new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="background:#0e0f11;color:#f0f0ee;font:16px -apple-system,sans-serif;padding:40px">' +
      '<h2>Atlas OFP</h2><p>No connection, and the app hasn’t been saved on this iPad yet.</p>' +
      '<p>Open it once with a good connection, then it works offline.</p>' +
      '<p><a style="color:#60a5fa" href="./">Try again</a></p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  })());
});
