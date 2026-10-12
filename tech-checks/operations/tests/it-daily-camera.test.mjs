import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const availability = await import('data:text/javascript;base64,' + Buffer.from(read('it-feature-availability.js')).toString('base64'));
const base = 'https://synthetic.example/tech-checks/operations/dist/index.html';

test('daily camera links carry presentation scope and preserve diagnostic query and fragment', () => {
  for (const search of ['?mode=fleet', '?mode=it-daily', '?itDaily=1', '?mode=it-daily&unit=synthetic']) {
    for (const href of ['../../camera-health.html', '../../camera-health.html?unit=HELIOS%20001&action=edit-field#history', '../../camera-detail.html?id=17&action=edit-ip', './camera-health.html?q=Solar+Spotter+51', 'camera-detail.html?id=3']) {
      const before = new URL(href, base), after = new URL(availability.itDailyCameraUrl(href, search), base);
      assert.equal(after.origin, before.origin);
      assert.equal(after.pathname, before.pathname);
      assert.equal(after.hash, before.hash);
      assert.equal(after.searchParams.get('itDaily'), '1');
      after.searchParams.delete('itDaily');
      assert.deepEqual([...after.searchParams], [...before.searchParams]);
    }
  }
});

test('camera scope helper is idempotent and never marks ordinary Owner or unrelated destinations', () => {
  const href = '../../camera-detail.html?id=17&itDaily=1';
  assert.equal(new URL(availability.itDailyCameraUrl(href, '?mode=fleet'), base).searchParams.getAll('itDaily').length, 1);
  for (const target of ['../../camera-health.html?itDaily=0','../../camera-detail.html?itDaily=0&itDaily=1']) assert.deepEqual(new URL(availability.itDailyCameraUrl(target,'?mode=it-daily'),base).searchParams.getAll('itDaily'),['1']);
  for (const search of ['', '?mode=production-assignments', '?mode=owner', '?itDaily=0']) {
    assert.equal(availability.itDailyCameraUrl('../../camera-health.html?unit=HELIOS%20001', search), '../../camera-health.html?unit=HELIOS%20001');
  }
  for (const target of ['https://vrm.victronenergy.com/installation/123/dashboard', 'https://na.reconeyez.com', 'http://192.0.2.5:8443', 'https://other.example/camera-health.html', '//other.example/camera-detail.html', './onsite-vision.html', './it-send-repair.html', './?fieldView=1', '#history']) {
    assert.equal(availability.itDailyCameraUrl(target, '?mode=fleet'), target);
  }
});

test('legacy camera daily adapter contains no network, authentication or workflow writes', () => {
  const source = read('it-daily-camera-host.js');
  assert.match(source, /IT_DAILY_ONLY/);
  assert.match(source, /itDailyCameraUrl/);
  const withoutExistingReturnFlag = source.replace("sessionStorage.setItem('cameraHealthReturnRequested','1')", '');
  assert.doesNotMatch(withoutExistingReturnFlag, /\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(|\.functions\.invoke\s*\(|\.auth\.|localStorage|sessionStorage/);
  for (const name of ['camera-health.html', 'camera-detail.html']) {
    const html = read(name);
    assert.equal((html.match(/<script\b[^>]*src=["']\.\/it-daily-camera-host\.js(?:\?[^"']*)?["'][^>]*><\/script>/g) || []).length, 1, name + ' loads the presentation adapter exactly once');
  }
});

test('camera browser fixture parses for every synthetic identity without loading a browser', () => {
  const source = readFileSync(new URL('./it-daily-camera.browser.spec.mjs', import.meta.url), 'utf8');
  const fixtureSource = source.slice(source.indexOf('function fixture(role)'), source.indexOf('\nasync function mount('));
  const context = vm.createContext({});
  new vm.Script(fixtureSource + '\nthis.makeFixture = fixture;').runInContext(context);
  for (const role of [null, 'it', 'owner']) {
    const html = context.makeFixture(role);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  }
});
