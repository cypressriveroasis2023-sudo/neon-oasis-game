import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {portUnreachableTally, routerRowView, SHOP_LABEL} from '../src/shopReader.ts';
import {routerSnapshot, routerStatus} from '../../supabase/functions/cos-operations-pages/routers.ts';

const now = new Date('2026-10-05T21:00:00Z');
const checked = '2026-10-05T20:59:00Z';

function overview(){
  const context = vm.createContext({Intl, Date});
  for (const file of ['camera-health-history.js', 'camera-health-overview.js']) vm.runInContext(readFileSync(new URL('../../'+file, import.meta.url), 'utf8'), context);
  return context.CameraHealthOverview;
}

const shopGroup = {
  k: 'SNIPER 80', scope: 'shop', state: 'shop', serviceState: 'offline', providerState: 'online', systemKind: 'camera',
  ds: [{id: 1, unit_key: 'SNIPER 80', organization: 'ROOT', activation_state: 'DEACTIVATED', device_name: 'Shop camera', device_type: 'Sniper', source_status: 'offline', source_last_seen_at: checked}],
};

test('opening a Shop unit components view says In Shop and never Offline', () => {
  const api = overview();
  const open = role => api.details(shopGroup, {health: {}, cameraGroup: () => 'Sniper', effectiveHealth: () => 'offline', reconBatteryBadge: () => '', role});
  const owner = open('Owner');
  assert.match(owner, /statuspill shop">In Shop</);
  assert.match(owner, /Last check failed\. Oct 5, 2026/);
  assert.doesNotMatch(owner, /offline/i);
  const other = open('Service');
  assert.match(other, /In Shop/);
  assert.doesNotMatch(other, /Last check failed/);
  assert.doesNotMatch(other, /offline/i);
  const field = api.details({...shopGroup, scope: 'field', state: 'offline'}, {health: {}, cameraGroup: () => 'Sniper', effectiveHealth: () => 'offline', reconBatteryBadge: () => '', role: 'Owner'});
  assert.match(field, /OFFLINE/);
});

test('a Field unit with ROOT inventory stays Field and outage-eligible', () => {
  const api = overview();
  const device = {id: 1, unit_key: 'SNIPER 90', organization: 'ROOT', activation_state: 'ACTIVE', device_name: 'Field camera', device_type: 'ipc', source: 'vigilant_control_center', source_status: 'offline', source_last_seen_at: checked, current_location_type: 'field', placement: 'field'};
  assert.equal(api.placement(device, []), 'field');
  const group = api.classifyUnit([device], [], +now, {});
  assert.equal(group.scope, 'field');
  assert.notEqual(group.state, 'shop');
  const html = api.details({k: 'SNIPER 90', ...group, ds: [device]}, {health: {}, cameraGroup: () => 'Camera', effectiveHealth: () => 'offline', reconBatteryBadge: () => '', role: 'Owner'});
  assert.doesNotMatch(html, /In Shop/);
  assert.match(html, /OFFLINE/);
  const unit = {id: '33333333-3333-4333-8333-333333333333', unit_number: 'SNIPER 90', current_location_type: 'field'};
  const router = {id: 9, unit_key: 'SNIPER 90', router_name: 'Field router', router_model: 'IR302', router_public_ip: '192.0.2.90', web_port: 8080, web_protocol: 'http', current_status: 'offline', last_checked_at: checked, inhand_serial: 'SERIAL-90', router_serial: 'SERIAL-90', last_online_at: '2026-09-10T10:00:00Z', reported_status: 'offline', status_observed_at: '2026-09-22T10:00:00Z', status_source: 'inhand_export', reported_latency_ms: 40};
  const deviceRow = {id: 9, unit_key: 'SNIPER 90', organization: 'ROOT', device_serial: 'SERIAL-90'};
  const row = routerSnapshot([router], [unit], now, [deviceRow]).items[0];
  assert.notEqual(row.boardStatus, 'In Shop');
  assert.equal(row.candidateUnit.placement, 'field');
  assert.equal(routerRowView(row), null);
  assert.equal(portUnreachableTally([row], +now), 1);
});

test('the Routers page shows In Shop and a Shop unit adds 0 to Port unreachable', () => {
  const unit = {id: '11111111-1111-4111-8111-111111111111', unit_number: 'SNIPER 80', current_location_type: 'shop'};
  const router = {id: 1, unit_key: 'SNIPER 80', router_name: 'Shop router', router_model: 'IR302', router_public_ip: '192.0.2.10', web_port: 8080, web_protocol: 'http', current_status: 'offline', last_checked_at: checked, last_online_at: '2026-09-10T10:00:00Z', reported_status: 'offline', status_observed_at: '2026-09-22T10:00:00Z', status_source: 'inhand_export', reported_latency_ms: 40};
  const row = routerSnapshot([router], [unit], now).items[0];
  assert.equal(row.probeStatus, 'offline');
  assert.equal(row.candidateUnit.placement, 'shop');
  const owner = routerRowView(row, 'Owner');
  assert.equal(owner.primary, SHOP_LABEL);
  assert.equal(owner.visibleProbe, SHOP_LABEL);
  assert.match(owner.detail, /Last check failed/);
  assert.doesNotMatch(owner.visibleProbe + owner.primary + owner.detail, /offline/i);
  assert.equal(routerRowView(row, 'Service').detail, null);
  const board = routerRowView({...row, boardStatus: 'In Shop', candidateUnit: null}, 'IT');
  assert.equal(board.primary, SHOP_LABEL);
  assert.match(board.detail, /Last check failed/);
  const field = routerSnapshot([{...router, id: 2, unit_key: 'SNIPER 81', current_status: 'offline'}], [{id: '22222222-2222-4222-8222-222222222222', unit_number: 'SNIPER 81', current_location_type: 'site'}], now).items[0];
  assert.equal(portUnreachableTally([row, field], +now), 1);
  assert.equal(routerStatus(field, +now), 'unreachable');
  assert.equal(portUnreachableTally([row], +now), 0);
});
