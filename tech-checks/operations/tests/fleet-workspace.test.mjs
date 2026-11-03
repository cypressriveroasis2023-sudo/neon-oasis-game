import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import FleetEquipmentCards from '../src/FleetEquipmentCards.tsx';
import {filterSourceEquipment} from '../src/fleetRecordedRoster.ts';
import {initialFleetFilters,fleetDashboardRows} from '../src/fleetDashboardModel.ts';
const now=Date.parse('2026-11-03T14:00:00Z');
const units=[{id:'helios',unitNumber:'Helios 001',modelName:'Helios',currentLocationType:'field',customer:'Example customer',address:'123 Example St'},{id:'stand',unitNumber:'Stand 001',modelName:'Stands',currentLocationType:'field'}];
const rows=fleetDashboardRows(units,null,null,null,now);
test('equipment cards preserve unknown evidence and never fabricate Victron readings',()=>{
 const html=renderToStaticMarkup(React.createElement(FleetEquipmentCards,{rows:[rows[0]],now,onOpen:()=>{},lastKnown:()=>null}));
 assert.match(html,/Helios 001/);assert.match(html,/Unverified/);assert.match(html,/No unique Victron installation linked/);assert.doesNotMatch(html,/80%|Online|100%/);
});
test('stand cards show site and placement without camera/router status controls',()=>{
 const html=renderToStaticMarkup(React.createElement(FleetEquipmentCards,{rows:[rows[1]],now,onOpen:()=>{},lastKnown:()=>null}));
 assert.match(html,/0 cameras/);assert.match(html,/excluded from camera outages/);assert.match(html,/Field/);assert.doesNotMatch(html,/Camera \/ connection|Router|Victron|Unverified/);
});
test('dedicated source lists contain only the selected equipment type and preserve placement filters',()=>{
 const items=[['h','Helios 003','Helios','field'],['s','Solar Stand 001','Solar Stands','field'],['c','Spotter 001','Spotter','field'],['ss','Stand 002','Stands','shop']].map(([id,unitNumber,category,placement])=>({id,unitNumber,category,placement,kind:'source_equipment',active:true,productIds:[id]}));
 assert.deepEqual(filterSourceEquipment(items,initialFleetFilters,'helios').map(r=>r.id),['h']);
 assert.deepEqual(filterSourceEquipment(items,initialFleetFilters,'stands').map(r=>r.id),['s']);
 assert.deepEqual(filterSourceEquipment(items,{...initialFleetFilters,placement:'shop'},'stands').map(r=>r.id),['ss']);
});
