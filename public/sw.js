/*
 * One-release service-worker retirement bridge.
 *
 * QAtrial formerly cached the app shell under a fixed cache name and served it
 * cache-first. That can pin a browser to obsolete JavaScript indefinitely.
 * New clients do not register a service worker. This bridge lets already
 * registered clients recover automatically on their next update check.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();

    // The old worker may have supplied the current document. Reload every
    // open window only after its cached shell has been cleared.
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});