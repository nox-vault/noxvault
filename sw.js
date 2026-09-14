/*
  Nox Vault retired service worker.
  Current Nox Vault does NOT use a service worker.
  If an older installation checks this URL for an update, this worker immediately
  clears Nox Vault caches and unregisters itself.
*/
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('nox-vault')).map(k => caches.delete(k)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      for (const client of windows) client.navigate(client.url);
    } catch (_) {}
  })());
});
