import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';

const source = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
const cacheName = 'tech-check-service-direct-20260928g';
const scopes = [
  'https://cos.example/',
  'https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/tech-checks/',
];

function harness(scope, options = {}) {
  const listeners = new Map();
  const saved = new Map(options.saved || []);
  const calls = { fetch: [], put: [], match: [], open: [], globalMatch: 0, waitUntil: [] };
  class FixtureRequest {
    constructor(input, init = {}) {
      Object.assign(this, typeof input === 'string' ? { url: new URL(input, scope).href } : input, init);
      this.method ||= 'GET';
      this.credentials ||= 'same-origin';
      this.headers ||= { 'x-fixture-session': 'fixture-only' };
    }
  }
  const key = value => typeof value === 'string' ? new URL(value, scope).href : value.url;
  const withoutSearch = value => { const url = new URL(value); url.search = ''; return url.href; };
  const cache = {
    async match(request, opts = {}) {
      const url = key(request);
      calls.match.push({ url, opts });
      if (options.matchFails) throw Error('fixture cache read failed');
      for (const [savedUrl, response] of saved) {
        if (opts.ignoreSearch ? withoutSearch(savedUrl) === withoutSearch(url) : savedUrl === url) return response.clone();
      }
    },
    async put(request, response) {
      if (options.putFails) throw Error('fixture quota failure');
      await options.beforePut?.();
      calls.put.push(key(request));
      saved.set(key(request), response.clone());
    },
    async add() {},
  };
  const context = {
    URL, Request: FixtureRequest, Response,
    self: { registration: { scope }, location: { origin: new URL(scope).origin }, addEventListener(name, handler) { listeners.set(name, handler); } },
    caches: {
      async open(name) {
        calls.open.push(name);
        if (options.openFails) throw Error('fixture cache unavailable');
        assert.equal(name, cacheName);
        return cache;
      },
      async match() { calls.globalMatch++; throw Error('unrelated origin caches must not be searched'); },
    },
    async fetch(request) {
      calls.fetch.push(request);
      if (options.fetch) return options.fetch(request, calls.fetch.length);
      throw TypeError('fixture network unavailable');
    },
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return {
    calls, saved,
    async navigate(path = './', extra = {}) {
      const request = new FixtureRequest(new URL(path, scope).href, { mode: 'navigate', destination: 'document', ...extra });
      let responsePromise;
      const waits = [];
      let dispatching = true;
      let pending = 0;
      const extendLifetime = value => {
        pending++;
        Promise.resolve(value).then(() => pending--, () => pending--);
      };
      listeners.get('fetch')({
        request,
        respondWith(value) {
          assert.ok(dispatching, 'respondWith must be called during dispatch');
          responsePromise = value;
          extendLifetime(value);
        },
        waitUntil(value) {
          assert.ok(dispatching || pending > 0, 'waitUntil needs an active extendable event');
          calls.waitUntil.push({ dispatching, pending });
          waits.push(value);
          extendLifetime(value);
        },
      });
      dispatching = false;
      const response = await responsePromise;
      await Promise.all(waits);
      return { response, request };
    },
  };
}

for (const scope of scopes) {
  test(`${scope}: successful HTTP navigation is returned and cached without changing credentials`, async () => {
    const network = new Response('<h1>fixture live workspace</h1>');
    const h = harness(scope, { fetch: async () => network });
    const { response, request } = await h.navigate('operations/dist/index.html?v=fixture', { credentials: 'include' });
    assert.equal(response, network);
    assert.equal(h.calls.fetch.length, 1);
    assert.equal(h.calls.fetch[0].cache, 'reload');
    assert.equal(h.calls.fetch[0].credentials, request.credentials);
    assert.equal(h.calls.fetch[0].headers, request.headers);
    assert.equal(h.calls.fetch[0].url, request.url);
    assert.deepEqual(h.calls.put, [request.url]);
    assert.equal(await h.saved.get(request.url).text(), '<h1>fixture live workspace</h1>');
    assert.equal(h.calls.globalMatch, 0);
  });

  for (const status of [302, 401, 403, 404, 429, 500, 503]) {
    test(`${scope}: HTTP ${status} survives intact despite a cached successful page`, async () => {
      const url = new URL('operations/dist/index.html', scope).href;
      const network = new Response('real server response', { status, headers: { 'x-origin-result': 'fixture', ...(status === 302 ? { location: '/fixture-login' } : {}) } });
      const h = harness(scope, { saved: [[url, new Response('old cached workspace')]], fetch: async () => network });
      const { response } = await h.navigate(url);
      assert.equal(response, network);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-origin-result'), 'fixture');
      assert.equal(await response.text(), 'real server response');
      assert.deepEqual(h.calls.match, []);
      assert.deepEqual(h.calls.put, []);
      assert.equal(h.calls.fetch.length, 1);
    });
  }

  test(`${scope}: network failure can use the exact cached iframe, ignoring its version query`, async () => {
    const url = new URL('operations/dist/index.html?v=old-fixture', scope).href;
    const h = harness(scope, { saved: [[url, new Response('cached iframe')]] });
    const { response } = await h.navigate('operations/dist/index.html?v=new-fixture', { destination: 'iframe' });
    assert.equal(await response.text(), 'cached iframe');
    assert.equal(h.calls.fetch.length, 1);
    assert.equal(h.calls.globalMatch, 0);
    assert.deepEqual(h.calls.put, []);
  });

  for (const alias of ['./', 'index.html', new URL(scope).pathname.replace(/\/$/, '') || '/']) {
    test(`${scope}: network failure uses its own cached shell for root alias ${alias}`, async () => {
      const h = harness(scope, { saved: [[scope, new Response('cached own shell')]] });
      const { response } = await h.navigate(alias);
      assert.equal(await response.text(), 'cached own shell');
      assert.equal(h.calls.fetch.length, 1);
      assert.equal(h.calls.globalMatch, 0);
    });
  }

  test(`${scope}: cached Vision works only for its exact scope path`, async () => {
    const h = harness(scope, { saved: [[new URL('onsite-vision.html', scope).href, new Response('cached own vision')]] });
    assert.equal(await (await h.navigate('onsite-vision.html?v=fixture')).response.text(), 'cached own vision');
    const nested = (await h.navigate('unrelated/onsite-vision.html')).response;
    assert.equal(nested.status, 503);
    assert.match(await nested.text(), /Workspace couldn't load/);
  });

  test(`${scope}: missing iframe does not substitute the host or Vision shell`, async () => {
    const h = harness(scope, { saved: [[scope, new Response('host auth shell')], [new URL('onsite-vision.html', scope).href, new Response('vision shell')]] });
    const { response } = await h.navigate('operations/dist/index.html', { destination: 'iframe' });
    assert.equal(response.status, 503);
    const html = await response.text();
    assert.match(html, /Workspace couldn't load/);
    assert.doesNotMatch(html, /host auth shell|vision shell/);
    assert.equal(h.calls.fetch.length, 1);
  });

  for (const status of [401, 403, 404, 500, 503]) {
    for (const path of ['./', 'onsite-vision.html', 'operations/dist/index.html']) {
      test(`${scope}: cached HTTP ${status} is not used as an offline page for ${path}`, async () => {
        const h = harness(scope, { saved: [[new URL(path, scope).href, new Response('old cached error', { status })]] });
        const { response } = await h.navigate(path);
        assert.equal(response.status, 503);
        const html = await response.text();
        assert.match(html, /Workspace couldn't load/);
        assert.doesNotMatch(html, /old cached error/);
        assert.equal(h.calls.put.length, 0);
      });
    }
  }

  test(`${scope}: failed cached index alias can still use a successful scope shell`, async () => {
    const h = harness(scope, { saved: [
      [new URL('index.html', scope).href, new Response('old cached Offline', { status: 503 })],
      [scope, new Response('valid cached scope shell')],
    ] });
    assert.equal(await (await h.navigate('index.html')).response.text(), 'valid cached scope shell');
  });

  test(`${scope}: unavailable page offers manual same-document retry without URL data or camera-outage claims`, async () => {
    const h = harness(scope);
    const { response } = await h.navigate('operations/dist/index.html?private-fixture=do-not-embed');
    const html = await response.text();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(html, /<button type="button" id="retry">Try again<\/button>/);
    const scripts = [...html.matchAll(/<script>([^<]+)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0][1], "document.getElementById('retry').addEventListener('click',()=>location.reload());");
    const hash = createHash('sha256').update(scripts[0][1]).digest('base64');
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'sha256-" + hash + "'"));
    assert.match(html, /does not tell us whether any camera or unit is online/);
    assert.doesNotMatch(html, /onclick|http-equiv|private-fixture|do-not-embed/);
    assert.equal(h.calls.fetch.length, 1);
    assert.deepEqual(h.calls.put, []);
  });

  test(`${scope}: repeated user retries fetch once each and can recover without stale failure caching`, async () => {
    const h = harness(scope, { fetch: async (_request, n) => {
      if (n < 3) throw TypeError('fixture network unavailable');
      return new Response('recovered live workspace');
    } });
    for (let attempt = 1; attempt <= 2; attempt++) {
      assert.equal((await h.navigate('operations/dist/index.html')).response.status, 503);
      assert.equal(h.calls.fetch.length, attempt);
      assert.equal(h.saved.size, 0);
    }
    assert.equal(await (await h.navigate('operations/dist/index.html')).response.text(), 'recovered live workspace');
    assert.equal(h.calls.fetch.length, 3);
    assert.equal(h.saved.size, 1);
  });
}

test('asynchronous fetch keeps waitUntil active through delayed cache completion', async () => {
  let releaseFetch;
  let releaseCache;
  let enteredCache;
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const cacheGate = new Promise(resolve => { releaseCache = resolve; });
  const cacheStarted = new Promise(resolve => { enteredCache = resolve; });
  const h = harness(scopes[0], {
    fetch: async () => { await fetchGate; return new Response('async fresh page'); },
    beforePut: async () => { enteredCache(); await cacheGate; },
  });
  let completed = false;
  const navigation = h.navigate().then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.calls.waitUntil.length, 0);
  releaseFetch();
  await cacheStarted;
  assert.equal(h.calls.waitUntil.length, 1);
  assert.equal(h.calls.waitUntil[0].dispatching, false);
  assert.ok(h.calls.waitUntil[0].pending > 0, 'respondWith lifetime is still active after asynchronous fetch');
  assert.equal(completed, false, 'cache completion remains in the event lifetime');
  releaseCache();
  assert.equal(await (await navigation).response.text(), 'async fresh page');
  assert.equal(h.calls.put.length, 1);
});

for (const failure of ['openFails', 'putFails']) {
  test(`${failure} does not hide a fresh successful HTTP response`, async () => {
    const network = new Response('fresh despite cache failure');
    const h = harness(scopes[0], { [failure]: true, fetch: async () => network });
    assert.equal((await h.navigate()).response, network);
  });
}
for (const failure of ['openFails', 'matchFails']) {
  test(`${failure} with network failure resolves to the retry page`, async () => {
    const h = harness(scopes[0], { [failure]: true });
    assert.equal((await h.navigate()).response.status, 503);
  });
}
for (const [name, path, extra] of [
  ['POST writes', './', { method: 'POST' }],
  ['cross-origin navigation', 'https://other.example/', {}],
  ['API reads', './api/fixture', { mode: 'cors', destination: '' }],
]) {
  test(`${name} remain outside this worker fetch interception`, async () => {
    const h = harness(scopes[0]);
    assert.equal((await h.navigate(path, extra)).response, undefined);
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.calls.open.length, 0);
  });
}
