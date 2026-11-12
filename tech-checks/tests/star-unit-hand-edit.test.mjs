import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'star-hand-edit-'));
execFileSync('npx', ['tsc', 'operations/shared/starUnitHandEdit.ts', 'operations/shared/starUnitStatus.ts',
  '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'bundler',
  '--allowImportingTsExtensions', '--rewriteRelativeImportExtensions', '--outDir', dir], {cwd: process.cwd(), stdio: 'pipe'});
writeFileSync(join(dir, 'package.json'), JSON.stringify({type: 'module'}));
const {checkedHandEditRequest, publicIpv4, HandEditError} = await import(join(dir, 'starUnitHandEdit.js'));

const REQUEST = '0d3a6038-1f3e-4a2e-9d7a-2b9c6f5a1e44';
const units = [
  {unit: 'SOLARSPOTTER 029', placement: 'SHOP', site: null, publicIp: '38.246.193.162'},
  {unit: 'SPOTTER 306', placement: 'FIELD', site: 'Evergen Equity - Chair King', publicIp: '38.246.194.14'},
];
const newId = () => REQUEST;
const check = (body) => checkedHandEditRequest(body, units, newId);
const refuses = (body, pattern) => {
  try { check(body); } catch (error) {
    assert.ok(error instanceof HandEditError, 'expected a HandEditError, got ' + error);
    assert.match(error.message, pattern);
    return error;
  }
  throw new Error('Expected a refusal: ' + JSON.stringify(body));
};

test('a unit can be moved to the field or back to the shop', () => {
  assert.deepEqual(check({unitKey: 'SOLARSPOTTER 029', field: 'placement', value: 'field'}),
    {unitKey: 'SOLARSPOTTER 029', field: 'placement', action: 'set', value: 'FIELD', providerValue: 'SHOP', reason: null, requestId: REQUEST});
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'placement', value: 'SHOP'}).providerValue, 'FIELD');
});

test('the provider value is read here, never taken from the caller', () => {
  refuses({unitKey: 'SPOTTER 306', field: 'site', value: 'Somewhere', providerValue: 'lies'}, /unsupported fields: providerValue/);
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'site', value: 'Somewhere'}).providerValue, 'Evergen Equity - Chair King');
  assert.equal(check({unitKey: 'SOLARSPOTTER 029', field: 'public_ip', value: '38.246.195.93'}).providerValue, '38.246.193.162');
});

test('only a unit Star4Live reports can be edited', () => {
  refuses({unitKey: 'SPOTTER 999', field: 'site', value: 'Nowhere'}, /not reporting a unit named SPOTTER 999/);
  const error = refuses({unitKey: 'SPOTTER 999', field: 'site', value: 'Nowhere'}, /Only a unit the provider reports/);
  assert.equal(error.status, 404);
  assert.equal(check({unitKey: ' solarspotter 029 ', field: 'placement', value: 'FIELD'}).unitKey, 'SOLARSPOTTER 029');
});

test('a hand edit cannot touch camera status or anything else', () => {
  for (const field of ['vigilant_status', 'state', 'online', 'unit_key', 'organization', '']) {
    refuses({unitKey: 'SPOTTER 306', field, value: 'Online'}, /where a unit is, its site, or its public IP only/);
  }
});

test('a site name is checked, and root is not a site name', () => {
  assert.equal(check({unitKey: 'SOLARSPOTTER 029', field: 'site', value: '  ERock - Hyperion  '}).value, 'ERock - Hyperion');
  refuses({unitKey: 'SOLARSPOTTER 029', field: 'site', value: 'root'}, /root is not a site name/);
  refuses({unitKey: 'SOLARSPOTTER 029', field: 'site', value: 'SHOP'}, /root is not a site name/);
  refuses({unitKey: 'SOLARSPOTTER 029', field: 'site', value: 'A'.repeat(121)}, /too long/);
  refuses({unitKey: 'SOLARSPOTTER 029', field: 'site', value: 'Bad\u0007name'}, /cannot be stored/);
  refuses({unitKey: 'SOLARSPOTTER 029', field: 'site', value: '   '}, /A value is required/);
});

test('only a public IPv4 is accepted', () => {
  assert.equal(check({unitKey: 'SOLARSPOTTER 029', field: 'public_ip', value: ' 38.246.195.93 '}).value, '38.246.195.93');
  for (const value of ['10.0.0.1', '192.168.10.17', '172.16.4.4', '127.0.0.1', '169.254.1.1', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '1.2.3', '1.2.3.4.5', '1.2.3.256', '01.2.3.4', 'not an ip',
    '38.246.195.93/24', '2001:db8::1']) {
    refuses({unitKey: 'SOLARSPOTTER 029', field: 'public_ip', value}, /not a public IPv4/);
    assert.equal(publicIpv4(value), null, value);
  }
  assert.equal(publicIpv4('166.203.205.83'), '166.203.205.83');
});

test('a placement is one of two words', () => {
  for (const value of ['ROOT', 'field or shop', 'FIELDS', 'yes']) {
    refuses({unitKey: 'SOLARSPOTTER 029', field: 'placement', value}, /either in the FIELD or in the SHOP/);
  }
});

test('clearing an edit takes no value', () => {
  assert.deepEqual(check({unitKey: 'SPOTTER 306', field: 'site', action: 'clear'}),
    {unitKey: 'SPOTTER 306', field: 'site', action: 'clear', value: null, providerValue: 'Evergen Equity - Chair King', reason: null, requestId: REQUEST});
  refuses({unitKey: 'SPOTTER 306', field: 'site', action: 'clear', value: 'Something'}, /does not take a value/);
  refuses({unitKey: 'SPOTTER 306', field: 'site', action: 'delete', value: 'x'}, /either set or clear/);
});

test('a reason is optional, bounded, and kept', () => {
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', reason: ' Tech moved it '}).reason, 'Tech moved it');
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', reason: '   '}).reason, null);
  refuses({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', reason: 'x'.repeat(401)}, /too long/);
});

test('a request id must be a UUID, and one is supplied when the caller omits it', () => {
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site'}).requestId, REQUEST);
  assert.equal(check({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', requestId: REQUEST}).requestId, REQUEST);
  refuses({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', requestId: 'not-a-uuid'}, /must be a UUID/);
});

test('a request that is not an object, or carries extra fields, is refused', () => {
  for (const body of [null, undefined, 'edit', 42, []]) refuses(body, /A hand edit request is required/);
  refuses({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', actorRole: 'owner'}, /unsupported fields: actorRole/);
  refuses({unitKey: 'SPOTTER 306', field: 'site', value: 'A Site', unit_key: 'other'}, /unsupported fields: unit_key/);
});
