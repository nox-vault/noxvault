const CACHE='nox-vault-shell-v2-hotfix-20260914';
const ASSETS=['./','./index.html','./decoy.html','./css/app.css','./css/decoy.css','./js/app.js','./js/backend.js','./js/firebase.js','./js/firebase-config.js','./js/utils.js','./assets/nox-mark.svg','./assets/nox-logo.svg','./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));});
