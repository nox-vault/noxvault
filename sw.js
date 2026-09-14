/*
  Nox Vault service-worker reset.
  This intentionally does NOT intercept requests or cache the app shell.
  It replaces older caching service workers so stale JavaScript cannot block login.
*/
const RESET_VERSION = 'nox-vault-reset-v3-20260914';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (error) {
      console.warn(RESET_VERSION, 'cache cleanup failed', error);
    }
    await self.clients.claim();
  })());
});
