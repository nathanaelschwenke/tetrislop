/* TetriSlop service worker: makes the game installable and playable offline.
 *
 * - Page (navigation): network first, cached copy when offline -> new deploys show up right away.
 * - Hashed build files (assets/*): cache first; they never change under the same name.
 *   Their names are read from index.html, so the bundle is cached on install and
 *   files from older deploys are pruned whenever a new index.html arrives.
 * - Icons, manifest, Google Fonts: stale-while-revalidate.
 * - Supabase and every other cross-origin request: not touched (telemetry always goes to the network).
 */
const CACHE = 'tetrislop-v1';
const STATIC = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
/** Vite's hashed build output (public/assets/ui/ holds user graphics and is not hashed). */
const isBuildAsset = (href) => href.startsWith(scopeUrl('./assets/')) && !href.startsWith(scopeUrl('./assets/ui/'));

/** URLs of the hashed build files referenced by an index.html. */
function assetUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)) {
    const url = scopeUrl(m[1]);
    if (isBuildAsset(url)) urls.add(url);
  }
  return urls;
}

async function cacheIndexAndAssets(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(scopeUrl('./'), response);
  const wanted = assetUrls(html);
  await Promise.all([...wanted].map(async (url) => {
    if (!(await cache.match(url))) await cache.add(url).catch(() => {});
  }));
  // prune build files of older deploys
  for (const req of await cache.keys()) {
    if (isBuildAsset(req.url) && !wanted.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(STATIC.map(scopeUrl));
    const index = await fetch(scopeUrl('./'), { cache: 'no-store' });
    if (index.ok) await cacheIndexAndAssets(index);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) cacheIndexAndAssets(response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await caches.match(scopeUrl('./'));
    return cached ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(self.registration.scope)) return;
    if (request.mode === 'navigate') event.respondWith(networkFirstPage(request));
    else if (isBuildAsset(url.href)) event.respondWith(cacheFirst(request));
    else event.respondWith(staleWhileRevalidate(request));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // everything else (Supabase API) goes straight to the network
});
