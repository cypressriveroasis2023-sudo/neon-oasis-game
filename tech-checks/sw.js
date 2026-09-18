const CACHE_NAME = 'tech-check-field-shell-v3';
const APP_SHELL = './';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(new Request(APP_SHELL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) { const cache=await caches.open(CACHE_NAME); cache.put(APP_SHELL,response.clone()).catch(() => {}); return response; }
      } catch (error) { console.warn('Navigation network request failed; using cached Tech Check shell', error); }
      const cachedShell = await caches.match(APP_SHELL, { ignoreSearch: true });
      if (cachedShell) return cachedShell;
      return fetch(APP_SHELL, { cache: 'reload' });
    })());
    return;
  }
  if (!['script','style','image','font','manifest'].includes(request.destination)) return;
  event.respondWith((async () => {
    const cached=await caches.match(request);
    const network=fetch(request).then(async response => { if (response.ok) { const cache=await caches.open(CACHE_NAME); cache.put(request,response.clone()).catch(() => {}); } return response; }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const response=await network;
    if (response) return response;
    return new Response('',{status:503,statusText:'Offline'});
  })());
});