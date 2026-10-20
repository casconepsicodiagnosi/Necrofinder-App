// Cache the app shell only. User-selected files and encrypted results never enter this cache.
const VERSION = 'necrofinder-seal-shell-v1';
const ASSETS = ['./', './index.html', './style.css', './app.mjs', './envelope.mjs', './encrypt-worker.mjs', './manifest.webmanifest', './necrofinder.png', './icons/180.png', './icons/192.png', './icons/512.png'];
const paths = new Set(ASSETS.map(path => new URL(path, self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const path of ASSETS) {
      const request = new Request(new URL(path, self.registration.scope), { cache: 'reload', redirect: 'error', credentials: 'same-origin' });
      const response = await fetch(request);
      if (!response.ok || response.redirected || new URL(response.url).origin !== self.location.origin) throw Error('App shell unavailable');
      if (/\.(mjs|css|png|webmanifest)$/.test(path) && response.headers.get('content-type')?.includes('text/html')) throw Error('Authentication response is not an app asset');
      await cache.put(request, response);
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('necrofinder-seal-shell-') && key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !paths.has(url.pathname) || url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    return await cache.match(event.request, { ignoreVary: true }) || fetch(event.request);
  })());
});
