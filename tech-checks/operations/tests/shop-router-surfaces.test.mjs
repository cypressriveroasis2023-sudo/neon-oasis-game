import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import FleetUnitHealth from '../src/FleetUnitHealth.tsx';
import FleetEquipmentCards from '../src/FleetEquipmentCards.tsx';
import {shownBoardRouterLabel} from '../../supabase/functions/cos-operations-pages/routerBoardJoin.mjs';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import {resource, snapshot, now, fresh} from './fixtures/camera-evidence-fixtures.mjs';

const shopUnit = {id: '00000000-0000-4000-8000-000000000004', unitNumber: 'Sniper 44', modelName: 'Snipers', currentLocationType: 'shop', placement: 'SHOP', status: 'available'};
const fieldUnit = {id: '00000000-0000-4000-8000-000000000002', unitNumber: 'Spotter 1', modelName: 'Spotter', currentLocationType: 'field', placement: 'FIELD', status: 'field'};
const health = snapshot([resource(4, 'Sniper 44', {scope: 'shop'}), resource(2, 'Spotter 1')]);
const router = {id: 'shop-router', unitKey: 'Sniper 44', name: 'Shop router', model: 'IR302', publicIp: null, match: 'exact_name', candidateUnit: {id: shopUnit.id, unitNumber: 'Sniper 44'}, probeStatus: 'offline', checkedAt: fresh, boardStatus: 'Offline', boardCheckedAt: fresh, doNotUse: false};
const fieldRouter = {...router, id: 'field-router', unitKey: 'Spotter 1', name: 'Field router', candidateUnit: {id: fieldUnit.id, unitNumber: 'Spotter 1'}, boardStatus: 'Offline'};

function shopRow() {
  return fleetDashboardRows([shopUnit], health, [router], {items: [], power: []}, now).find(row => row.name === 'Sniper 44');
}

test('the fleet card, unit details, equipment card, TV and Routers page say In Shop and never Offline', () => {
  const row = shopRow();
  assert.equal(row.placement, 'shop');
  assert.equal(row.routerLabel, 'In Shop');
  assert.equal(row.routerState, 'unknown');
  const details = renderToStaticMarkup(React.createElement(FleetUnitHealth, {row, now, routerNow: now}));
  assert.match(details, /cos-signal-shop/);
  assert.match(details, />In Shop</);
  assert.doesNotMatch(details, /Offline/);
  const cards = renderToStaticMarkup(React.createElement(FleetEquipmentCards, {rows: [row], now, routerNow: now, lastKnown: () => null, onOpen: () => {}}));
  assert.match(cards, /cos-signal-shop/);
  assert.match(cards, /In Shop/);
  assert.doesNotMatch(cards, /Offline/);
  const routers = readFileSync(new URL('../src/RouterWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(routers, /board === 'In Shop'/);
  assert.match(routers, /router-shop/);
  assert.equal(shownBoardRouterLabel('Offline', fresh, now, 'shop'), 'In Shop');
  assert.equal(shownBoardRouterLabel('Offline', fresh, now, 'ROOT'), 'Offline');
  assert.match(readFileSync(new URL('../src/TvFleetView.tsx', import.meta.url), 'utf8'), /shownBoardRouterLabel\(/);
  const css = readFileSync(new URL('../src/fleetDashboard.css', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/routers.css', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/tvBoardExtensions.css', import.meta.url), 'utf8');
  assert.match(css, /#64748b/);
  const field = fleetDashboardRows([fieldUnit], health, [fieldRouter], {items: [], power: []}, now).find(item => item.name === 'Spotter 1');
  assert.equal(field.routerLabel, 'Offline');
});
