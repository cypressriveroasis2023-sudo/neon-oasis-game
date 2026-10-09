const CACHE_NAME = 'tech-check-service-direct-20260928g';
// The same worker is published at the GitHub subpath and Cloudflare root.
const APP_SHELL = new URL('./', self.registration.scope).href;
const VISION_SHELL = new URL('onsite-vision.html', APP_SHELL).href;

function unavailableNavigation() {
  // A failed page request is not evidence about camera or unit connectivity.
  // A fixed, CSP-hashed handler reloads this exact document, including iframe
  // fragments, without automatic requests, session changes or workflow writes.
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cameras Onsite · Workspace unavailable</title>
<style>html{color-scheme:dark}body{margin:0;background:#0d1215;color:#fff;font:16px/1.5 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{box-sizing:border-box;width:min(100%,36rem);padding:2rem}h1{font-size:1.6rem;line-height:1.2}p{color:#ccc}button{display:inline-block;background:#fff;color:#0d1215;padding:.8rem 1.2rem;border:0;border-radius:.6rem;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:4px}</style>
</head><body><main><p>CAMERAS ONSITE</p><h1>Workspace couldn't load</h1>
<p>This browser couldn't reach the workspace page, and no saved page is available. Check your connection, then try again.</p>
<p>This page load does not tell us whether any camera or unit is online.</p>
<button type="button" id="retry">Try again</button><noscript><p>Reload this page to try again.</p></noscript></main>
<script>document.getElementById('retry').addEventListener('click',()=>location.reload());</script></body></html>`, {
    status: 503,
    statusText: 'Workspace Unavailable',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'sha256-A9CX4QlSqyB1GVk9l09AGanndVz8GvBqUl8tV8ex7UQ='; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    },
  });
}

async function cachedNavigation(request, url) {
  try {
    // Never take a page from an unrelated app's cache on this origin.
    const cache = await caches.open(CACHE_NAME);
    const cachedPage = await cache.match(request, { ignoreSearch: true });
    if (cachedPage?.ok) return cachedPage;
    const rootPath = new URL(APP_SHELL).pathname;
    const isRoot = url.pathname === rootPath ||
      url.pathname === rootPath.replace(/\/$/, '') ||
      url.pathname === `${rootPath}index.html`;
    if (url.pathname === new URL(VISION_SHELL).pathname) {
      const cachedVision = await cache.match(VISION_SHELL, { ignoreSearch: true });
      return cachedVision?.ok ? cachedVision : null;
    }
    if (isRoot) {
      const cachedRoot = await cache.match(APP_SHELL, { ignoreSearch: true });
      return cachedRoot?.ok ? cachedRoot : null;
    }
    // An Operations iframe must never receive the host/auth shell as its page.
  } catch {}
  return null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Shell first so install is resilient; performance assets are best-effort.
    await cache.add(new Request(APP_SHELL, { cache:'reload' }));
    await Promise.allSettled([
      cache.add(new Request(VISION_SHELL, { cache:'reload' })),
      cache.add(new Request('./tech-check-rules.js?v=helios-field-clarity-20260924q', { cache:'reload' })),
      cache.add(new Request('./app.js?v=service-direct-20260928g', { cache:'reload' })),
      cache.add(new Request('./technician-wizard-owner-dashboard-v5.js?v=service-direct-20260928g', { cache:'reload' })),
      cache.add(new Request('./team-email-settings.js?v=email-settings-v4', { cache:'reload' })),
      cache.add(new Request('./styles.css?v=owner-reset-visible-20260928c', { cache:'reload' })),
      cache.add(new Request('./onsite-vision.css?v=vision-integrated-20260927', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-company-knowledge.js?v=company-knowledge-v18', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-workflow-engine.js?v=workflow-engine-v6b', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-live-data.js?v=live-data-v7', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-actions.js?v=action-layer-v1', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-persistence.js?v=persistence-v2', { cache:'reload' })),
      cache.add(new Request('./onsite-vision-knowledge-admin.js?v=knowledge-admin-v1', { cache:'reload' })),
      cache.add(new Request('./onsite-vision.js?v=vision-integrated-20260927', { cache:'reload' }))
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
      let response;
      try {
        const freshRequest = new Request(request, { cache:'reload' });
        response = await fetch(freshRequest);
      } catch {
        return await cachedNavigation(request, url) || unavailableNavigation();
      }
      // Preserve actual HTTP errors, redirects and authentication responses.
      // A cache failure must not turn a successful network request into Offline.
      if (response.ok) {
        const cachedResponse = response.clone();
        event.waitUntil(caches.open(CACHE_NAME)
          .then(cache => cache.put(request, cachedResponse))
          .catch(() => {}));
      }
      return response;
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
