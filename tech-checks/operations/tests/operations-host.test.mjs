import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const hostSource = readFileSync(new URL('../../operations-host.js', import.meta.url), 'utf8');
const origin = 'https://cypressriveroasis2023-sudo.github.io';
const ownerId = 'e4abc521-1ef3-45a6-9829-b87faff78210';
const secondOwnerId = '11111111-2222-4333-8444-555555555555';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ role = 'owner', userId = ownerId } = {}) {
  const observers = [];
  const nodes = new Map();
  const calls = { auth: 0, tabs: [], shows: [], routes: [], locations: [], logout: 0, technicianHomes: [] };
  const state = {
    role,
    effectiveRole: role,
    session: { user: { id: userId }, access_token: 'stale-legacy-snapshot' },
    profile: { user_id: userId, role, active: true },
    getFreshSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'fresh-owner-token' } } }),
  };
  const changed = target => {
    for (const observer of observers) {
      if (observer.targets.some(entry => entry.target === target && entry.options.attributes &&
          (!entry.options.attributeFilter || entry.options.attributeFilter.includes('class')))) observer.pending = true;
    }
  };
  class ClassList {
    constructor(target, values = []) { this.target = target; this.values = new Set(values); }
    contains(value) { return this.values.has(value); }
    toggle(value, force) {
      const wanted = force === undefined ? !this.values.has(value) : Boolean(force);
      if (wanted === this.values.has(value)) return wanted;
      if (wanted) this.values.add(value); else this.values.delete(value);
      changed(this.target);
      return wanted;
    }
    add(...values) { values.forEach(value => this.toggle(value, true)); }
    remove(...values) { values.forEach(value => this.toggle(value, false)); }
  }
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) {
      const list = this.listeners.get(type) || [];
      list.push(listener); this.listeners.set(type, list);
    }
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) || []) listener(event);
      return true;
    }
    async emit(type, extra = {}) {
      await Promise.all((this.listeners.get(type) || []).map(listener => listener({ type, ...extra })));
    }
  }
  class Element extends Events {
    constructor(id = '', classes = []) {
      super(); this.id = id; this.classList = new ClassList(this, classes);
      this.children = []; this.hidden = false; this.parentElement = null; this.removed = false;
    }
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this.children = children;
      children.forEach(child => { child.parentElement = this; });
    }
    remove() {
      this.removed = true;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    click() { this.dispatchEvent({ type: 'click', target: this }); }
  }
  const body = new Element('body');
  for (const id of ['view-owner', 'view-it', 'view-svc', 'appView', 'authView',
    'cosOperationsMount', 'cosOperationsLegacy', 'cosOperationsReturn', 'tab-it', 'tab-svc']) {
    nodes.set(id, new Element(id, ['view-it', 'view-svc', 'authView'].includes(id) ? ['hidden'] : []));
  }
  if (role !== 'owner') {
    nodes.get('view-owner').classList.add('hidden');
    nodes.get(role === 'service' ? 'view-svc' : 'view-it').classList.remove('hidden');
  }
  // A real persistent legacy node must survive all wrapper navigation.
  const accountControl = new Element('existingAccountControl');
  nodes.get('cosOperationsLegacy').replaceChildren(accountControl);
  const window = new Events();
  window.location = { origin, assign: value => calls.locations.push(value) };
  window.TechCheckContext = {
    db: { auth: { getSession: () => { calls.auth++; return state.getFreshSession(); } } },
    getSession: () => state.session,
    getProfile: () => state.profile,
    getRole: () => state.role,
    getEffectiveRole: () => state.effectiveRole,
  };
  window.show = view => {
    calls.shows.push(view);
    for (const name of ['owner', 'it', 'svc']) nodes.get('view-' + name).classList.toggle('hidden', name !== view);
    window.dispatchEvent({ type: 'techcheck:view-changed', detail: { view } });
  };
  window.ownerAppNavigate = route => calls.routes.push(route);
  window.logout = () => {
    calls.logout++;
    state.role = null; state.effectiveRole = null; state.session = null; state.profile = null;
    nodes.get('appView').classList.add('hidden');
    nodes.get('authView').classList.remove('hidden');
  };
  for (const [id, view, technicianRole] of [['tab-it', 'it', 'it'], ['tab-svc', 'svc', 'service']]) {
    nodes.get(id).addEventListener('click', () => {
      calls.tabs.push(id); window.show(view); calls.technicianHomes.push(technicianRole);
    });
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; this.pending = false; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
  }
  const document = {
    body,
    getElementById: id => nodes.get(id) || null,
    createElement: type => {
      assert.equal(type, 'iframe');
      const element = new Element();
      element.contentWindow = {
        messages: [],
        postMessage(value, targetOrigin) { this.messages.push({ value, targetOrigin }); },
      };
      return element;
    },
  };
  vm.runInNewContext(hostSource, { window, document, MutationObserver }, { filename: 'operations-host.js' });
  const flushMutations = () => {
    for (let round = 0; round < 20; round++) {
      const pending = observers.filter(observer => observer.pending);
      if (!pending.length) return;
      for (const observer of pending) { observer.pending = false; observer.callback(); }
    }
    assert.fail('Host caused a mutation observer loop');
  };
  const frame = () => nodes.get('cosOperationsMount').children[0] || null;
  const message = (data, source = frame()?.contentWindow, eventOrigin = origin) =>
    window.emit('message', { data, source, origin: eventOrigin });
  const navigate = route => message({ type: 'COS_OPERATIONS_NAVIGATE', route });
  const token = requestId => message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId });
  const preview = role => {
    state.effectiveRole = role || state.role;
    body.classList.toggle('owner-test-role-preview', Boolean(role));
    flushMutations();
  };
  flushMutations();
  return { state, calls, nodes, body, window, frame, message, navigate, token, preview, flushMutations, accountControl };
}

test('owner mounts isolated Operations and retains existing legacy controls', () => {
  const h = harness();
  assert.equal(h.frame().src, './operations/dist/index.html?v=operations-v100-20261004');
  assert.equal(h.frame().allow, 'geolocation');
  assert.equal(h.frame().referrerPolicy, 'same-origin');
  assert.equal(h.body.classList.contains('cos-operations-host'), true);
  assert.equal(h.nodes.get('cosOperationsMount').hidden, false);
  assert.equal(h.nodes.get('cosOperationsLegacy').hidden, true);
  assert.equal(h.accountControl.parentElement, h.nodes.get('cosOperationsLegacy'));
  assert.equal(h.calls.auth, 0);
});

test('real IT and Service accounts never receive Operations or owner navigation', async () => {
  for (const role of ['it', 'service']) {
    const h = harness({ role });
    const profile = h.state.profile;
    const session = h.state.session;
    assert.equal(h.frame(), null);
    assert.equal(h.body.classList.contains('cos-operations-host'), false);
    await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'technician' }, {});
    await h.message({ type: 'COS_OPERATIONS_NAVIGATE', route: 'accounts' }, {});
    assert.equal(h.calls.auth, 0);
    assert.equal(h.calls.routes.length, 0);
    assert.equal(h.state.profile, profile);
    assert.equal(h.state.session, session);
    assert.equal(h.nodes.get(role === 'it' ? 'view-it' : 'view-svc').classList.contains('hidden'), false);
  }
});

test('Operations role links click existing technician tabs and return to Operations', async () => {
  const h = harness();
  const profile = h.state.profile;
  for (const [route, tab, view] of [['it', 'tab-it', 'view-it'], ['service', 'tab-svc', 'view-svc']]) {
    await h.navigate(route); h.flushMutations();
    assert.equal(h.calls.tabs.at(-1), tab);
    assert.equal(h.calls.technicianHomes.at(-1), route);
    assert.equal(h.nodes.get(view).classList.contains('hidden'), false);
    assert.equal(h.body.classList.contains('cos-operations-host'), false);
    h.window.show('owner'); h.flushMutations();
    assert.equal(h.body.classList.contains('cos-operations-host'), true);
  }
  assert.equal(h.state.profile, profile);
  assert.equal(h.state.role, 'owner');
});

test('legacy navigation and return preserve persistent account and assignment mounts', async () => {
  const h = harness();
  const initialFrame = h.frame();
  for (const route of ['assign', 'accounts', 'testcenter']) {
    await h.navigate(route); h.flushMutations();
    assert.equal(h.calls.routes.at(-1), route);
    assert.equal(h.nodes.get('cosOperationsMount').hidden, true);
    assert.equal(h.nodes.get('cosOperationsLegacy').hidden, false);
    assert.equal(h.body.classList.contains('cos-operations-legacy'), true);
    assert.equal(h.accountControl.parentElement, h.nodes.get('cosOperationsLegacy'));
    h.nodes.get('cosOperationsReturn').click(); h.flushMutations();
    assert.equal(h.nodes.get('cosOperationsMount').hidden, false);
    assert.equal(h.nodes.get('cosOperationsLegacy').hidden, true);
    assert.equal(h.body.classList.contains('cos-operations-host'), true);
    assert.equal(h.frame(), initialFrame);
  }
  await h.navigate('unsupported-route');
  assert.deepEqual(h.calls.routes, ['assign', 'accounts', 'testcenter']);
});

test('token response uses fresh auth state, never the legacy cached access token', async () => {
  const h = harness();
  await h.token('fresh');
  const reply = h.frame().contentWindow.messages[0];
  assert.equal(h.calls.auth, 1);
  assert.equal(reply.targetOrigin, origin);
  assert.equal(reply.value.type, 'COS_OPERATIONS_TOKEN_RESPONSE');
  assert.equal(reply.value.requestId, 'fresh');
  assert.equal(reply.value.accessToken, 'fresh-owner-token');
  assert.equal(reply.value.role, 'owner');
  assert.equal(JSON.stringify(reply).includes('stale-legacy-snapshot'), false);
});

test('fresh auth identity mismatch, missing session, and auth errors fail closed', async () => {
  const cases = [
    async () => ({ data: { session: { user: { id: secondOwnerId }, access_token: 'other-account-token' } } }),
    async () => ({ data: { session: null } }),
    async () => { throw new Error('session refresh failed'); },
  ];
  for (const getFreshSession of cases) {
    const h = harness();
    h.state.getFreshSession = getFreshSession;
    await h.token('denied');
    const reply = h.frame().contentWindow.messages[0].value;
    assert.equal(reply.accessToken, null);
    assert.equal(reply.role, null);
  }
});

test('wrong origin, same-origin sibling, old frame, and malformed token messages are ignored', async () => {
  const h = harness();
  const initial = h.frame();
  await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'wrong-origin' }, initial.contentWindow, 'https://example.com');
  const sibling = { messages: [], postMessage(value) { this.messages.push(value); } };
  await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'sibling' }, sibling);
  await h.message({ type: 'COS_OPERATIONS_NAVIGATE', route: 'logout' }, sibling);
  for (const data of [null, 'token', { type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 42 },
    { type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'x'.repeat(101) }]) await h.message(data);
  assert.equal(h.calls.auth, 0);
  assert.equal(h.calls.logout, 0);
  assert.equal(initial.contentWindow.messages.length, 0);
  h.preview('it'); h.preview(null);
  assert.notEqual(h.frame(), initial);
  await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'old-frame' }, initial.contentWindow);
  assert.equal(h.calls.auth, 0);
  assert.equal(initial.contentWindow.messages.length, 0);
});

test('Owner Test IT and Service previews remove Operations and recreate it only after return', async () => {
  const h = harness();
  for (const role of ['it', 'service']) {
    const initial = h.frame();
    h.preview(role);
    assert.equal(initial.removed, true);
    assert.equal(h.frame(), null);
    assert.equal(h.body.classList.contains('cos-operations-host'), false);
    await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'preview' }, initial.contentWindow);
    assert.equal(initial.contentWindow.messages.length, 0);
    h.preview(null);
    assert.ok(h.frame());
    assert.notEqual(h.frame(), initial);
    assert.equal(h.body.classList.contains('cos-operations-host'), true);
  }
  assert.equal(h.state.role, 'owner');
  assert.equal(h.calls.auth, 0);
});

test('logout removes iframe and discards a token response already in flight', async () => {
  const h = harness();
  const initial = h.frame();
  const fresh = deferred();
  h.state.getFreshSession = () => fresh.promise;
  const pending = h.token('before-logout');
  await h.navigate('logout'); h.flushMutations();
  assert.equal(h.calls.logout, 1);
  assert.equal(initial.removed, true);
  assert.equal(h.frame(), null);
  assert.equal(h.body.classList.contains('cos-operations-host'), false);
  assert.equal(h.nodes.get('appView').classList.contains('hidden'), true);
  fresh.resolve({ data: { session: { user: { id: ownerId }, access_token: 'late-token' } } });
  await pending;
  assert.equal(initial.contentWindow.messages.length, 0);
});

test('account replacement discards prior owner request and starts a clean iframe', async () => {
  const h = harness();
  const initial = h.frame();
  const fresh = deferred();
  h.state.getFreshSession = () => fresh.promise;
  const pending = h.token('old-owner');
  h.state.session = { user: { id: secondOwnerId }, access_token: 'new-owner-snapshot' };
  h.state.profile = { user_id: secondOwnerId, role: 'owner', active: true };
  await h.window.emit('techcheck:data-refreshed'); h.flushMutations();
  assert.equal(initial.removed, true);
  assert.notEqual(h.frame(), initial);
  fresh.resolve({ data: { session: { user: { id: ownerId }, access_token: 'old-owner-fresh-token' } } });
  await pending;
  assert.equal(initial.contentWindow.messages.length, 0);
  assert.equal(h.frame().contentWindow.messages.length, 0);
});

test('effective role change during auth resolution cannot release an owner token', async () => {
  const h = harness();
  const fresh = deferred();
  h.state.getFreshSession = () => fresh.promise;
  const pending = h.token('preview-race');
  h.state.effectiveRole = 'service';
  fresh.resolve({ data: { session: { user: { id: ownerId }, access_token: 'owner-token' } } });
  await pending;
  const reply = h.frame().contentWindow.messages[0].value;
  assert.equal(reply.accessToken, null);
  assert.equal(reply.role, null);
});

test('unrelated body mutations do not remount Operations or cause observer loops', () => {
  const h = harness();
  const initial = h.frame();
  h.body.classList.add('busy'); h.flushMutations();
  h.body.classList.remove('busy'); h.flushMutations();
  assert.equal(h.frame(), initial);
  assert.equal(h.body.classList.contains('cos-operations-host'), true);
});

test('hiding the app removes iframe even with stale owner state and drops pending auth', async () => {
  const h = harness();
  const initial = h.frame();
  const fresh = deferred();
  h.state.getFreshSession = () => fresh.promise;
  const pending = h.token('before-hidden');
  h.nodes.get('appView').classList.add('hidden'); h.flushMutations();
  assert.equal(h.state.role, 'owner');
  assert.equal(h.state.session.user.id, ownerId);
  assert.equal(initial.removed, true);
  assert.equal(h.frame(), null);
  assert.equal(h.body.classList.contains('cos-operations-host'), false);
  fresh.resolve({ data: { session: { user: { id: ownerId }, access_token: 'hidden-app-token' } } });
  await pending;
  assert.equal(initial.contentWindow.messages.length, 0);
  await h.message({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId: 'hidden-again' }, initial.contentWindow);
  assert.equal(h.calls.auth, 1);
  h.nodes.get('appView').classList.remove('hidden'); h.flushMutations();
  assert.ok(h.frame());
  assert.notEqual(h.frame(), initial);
  assert.equal(h.body.classList.contains('cos-operations-host'), true);
});

test('app becoming hidden while auth resolves cannot release a token before observer delivery', async () => {
  const h = harness();
  const fresh = deferred();
  h.state.getFreshSession = () => fresh.promise;
  const pending = h.token('hide-race');
  h.nodes.get('appView').classList.add('hidden');
  fresh.resolve({ data: { session: { user: { id: ownerId }, access_token: 'hidden-race-token' } } });
  await pending;
  const reply = h.frame().contentWindow.messages[0].value;
  assert.equal(reply.accessToken, null);
  assert.equal(reply.role, null);
  h.flushMutations();
  assert.equal(h.frame(), null);
});
