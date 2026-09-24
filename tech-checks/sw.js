const CACHE_NAME = 'tech-check-owner-more-20260923av';
const APP_SHELL = './';
const VISION_SHELL = './onsite-vision.html';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Shell first so install is resilient; performance assets are best-effort.
    await cache.add(new Request(APP_SHELL, { cache:'reload' }));
    await Promise.allSettled([
      cache.add(new Request(VISION_SHELL, { cache:'reload' })),
      cache.add(new Request('./tech-check-rules.js?v=rules-v10', { cache:'reload' })),
      cache.add(new Request('./app.js?v=owner-more-20260923av', { cache:'reload' })),
      cache.add(new Request('./technician-wizard-owner-dashboard-v5.js?v=owner-all-jobs-20260923ak', { cache:'reload' })),
      cache.add(new Request('./team-email-settings.js?v=email-settings-v4', { cache:'reload' })),
      cache.add(new Request('./styles.css?v=owner-more-20260923av', { cache:'reload' })),
      cache.add(new Request('./onsite-vision.css?v=vision-workspace-v33', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-company-knowledge.js?v=company-knowledge-v18', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-workflow-engine.js?v=workflow-engine-v6b', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-live-data.js?v=live-data-v7', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-actions.js?v=action-layer-v1', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-persistence.js?v=persistence-v2', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-knowledge-admin.js?v=knowledge-admin-v1', { cache:'reload' })),
      cache.add(new Request('./onsite-vision.js?v=vision-workspace-v58', { cache:'reload' }))
    ]);
    await self.skipWaiting();
  })());
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
      const isVision = url.pathname.endsWith('/onsite-vision.html');
      const isRoot = /\/tech-checks\/?$/.test(url.pathname);
      const cachedPage = await caches.match(request, { ignoreSearch: true });
      try {
        const freshRequest = new Request(request, { cache:'reload' });
        const response = await fetch(freshRequest);
        if (response?.ok) {
          const cache=await caches.open(CACHE_NAME);
          cache.put(request,response.clone()).catch(() => {});
          return response;
        }
      } catch {}
      if (cachedPage) return cachedPage;
      if (isVision) {
        const cachedVision = await caches.match(VISION_SHELL, { ignoreSearch:true });
        if (cachedVision) return cachedVision;
        return fetch(VISION_SHELL, { cache:'reload' });
      }
      if (isRoot) {
        const cachedRoot = await caches.match(APP_SHELL, { ignoreSearch:true });
        if (cachedRoot) return cachedRoot;
        return fetch(APP_SHELL, { cache:'reload' });
      }
      return new Response('Offline', { status:503, statusText:'Offline' });
    })());
    return;
  }
  if (!['script','style','image','font','manifest'].includes(request.destination)) return;
  event.respondWith((async () => {
    const cached=await caches.match(request);
    const loadFresh=async()=>{
      try{
        const response=await fetch(new Request(request,{cache:'reload'}));
        if(response?.ok){
          const cache=await caches.open(CACHE_NAME);
          cache.put(request,response.clone()).catch(()=>{});
        }
        return response;
      }catch{return null;}
    };

    // JavaScript and CSS must be network-first. A technician should never keep
    // running an obsolete workflow or tutorial simply because an iPhone
    // resumed an older installed-app cache.
    if(request.destination==='script'||request.destination==='style'){
      const fresh=await loadFresh();
      if(fresh)return fresh;
      if(cached)return cached;
      return new Response('',{status:503,statusText:'Offline'});
    }

    if(cached){
      event.waitUntil(loadFresh());
      return cached;
    }
    const fresh=await loadFresh();
    if(fresh)return fresh;
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