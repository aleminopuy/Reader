// Service worker: makes the app open offline.
// - App files: network first (so your tweaks show up right away), cache as fallback.
// - Images inside newsletters: cached as you view them, so they show offline too.
// Gmail / Google sign-in / feed requests are never touched.

const APP_CACHE = 'letterbox-app-v1';
const IMG_CACHE = 'letterbox-img-v1';
const MAX_IMAGES = 400;
const APP_FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/store.js', 'src/db.js', 'src/gmail.js', 'src/demo.js', 'src/feeds.js',
  'src/clean.js', 'src/settings.js', 'src/config.js', 'src/icons.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (req.destination === 'image') {
    e.respondWith(cacheFirstImage(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
  }
}

async function cacheFirstImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(k);
}
