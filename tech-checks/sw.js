const CACHE_NAME = 'tech-check-field-shell-v30';
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

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || '' }; }

  const title = payload.title || 'Tech Check';
  const assignmentId = payload.assignment_id || '';
  const target = payload.url || './';
  const badgeCount = Math.max(1, Number(payload.badge_count || 1));
  event.waitUntil((async () => {
    try {
      if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(badgeCount);
    } catch {}
    return self.registration.showNotification(title, {
      body: payload.body || 'You have a new Tech Check notification.',
      icon: './techcheck-eye-192.png',
      badge: './techcheck-eye-favicon-32.png',
      tag: assignmentId ? 'techcheck-assignment-' + assignmentId : 'techcheck-alert',
      renotify: true,
      data: { url: target, assignment_id: assignmentId },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const same = list.find(client => {
        try { return new URL(client.url).origin === self.location.origin; }
        catch { return false; }
      });
      if (same) {
        same.focus();
        return same.navigate(target);
      }
      return clients.openWindow(target);
    })
  );
});
