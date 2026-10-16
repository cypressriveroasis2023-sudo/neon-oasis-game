import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import SniperInventory,{sniperInventory} from '../src/SniperInventory.tsx';
const row=(id,extra={})=>({recordId:'mhelp_product:'+id,productId:id,sourceUnitNumber:'Sniper '+id,category:'Sniper 2',customer:'Company',placement:'SHOP',uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked'},...extra});
const value=records=>({contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',receivedAt:'2026-10-15T23:38:25Z',summary:{totalRecords:records.length},records});
test('source inventory includes restricted Field and unlinked Shop without operational health or activation',()=>{
 const v=value([row('1',{sourceUnitNumber:'Sniper 80 - DO NOT USE',placement:'FIELD',uploadLifecycle:'DO_NOT_USE'}),row('2'),row('3',{category:'Helios'})]),copy=structuredClone(v),result=sniperInventory(v);
 assert.equal(result.records.length,2);assert.equal(result.field,1);assert.equal(result.shop,1);assert.equal(result.restricted,1);assert.deepEqual(v,copy);
 const html=renderToStaticMarkup(React.createElement(SniperInventory,{value:v}));assert.match(html,/Sniper 80 - DO NOT USE/);assert.match(html,/>SHOP</);assert.match(html,/>FIELD</);assert.doesNotMatch(html,/online|offline|SHOP \/ ROOT|Move to Field|data-unit-id/i);
});
test('Radar and Thermal stay distinct, exact labels survive and identity holds stay visible',()=>{
 const result=sniperInventory(value([row('1',{category:'Radar - Sniper',sourceUnitNumber:'Radar Sniper 80 '}),row('2',{category:'Thermal - Sniper',sourceUnitNumber:'Thermal Sniper 80 - DO NOT USE',uploadLifecycle:'DO_NOT_USE',binding:{state:'held'}})]));assert.equal(result.records.length,2);assert.equal(result.records[0].sourceUnitNumber,'Radar Sniper 80 ');assert.equal(result.records[1].binding.state,'held');
});
test('incomplete or duplicate source census cannot supply inventory totals',()=>{
 const v=value([row('1')]);assert.equal(sniperInventory({...v,summary:{totalRecords:2}}),null);assert.equal(sniperInventory(value([row('1'),row('1')])),null);assert.equal(sniperInventory(value([row('1',{placement:'unknown'})])),null);
});
test('inventory-only Shop has no current IP or SIM and cannot carry a linked health identity',()=>{
 const r=row('1',{inventoryOnlyReason:'no_sim',binding:{state:'held'}}),v=value([r]);const html=renderToStaticMarkup(React.createElement(SniperInventory,{value:v}));assert.match(html,/No SIM \/ no current IP/);assert.match(html,/>SHOP</);assert.doesNotMatch(html,/online|offline|203\.0\.113|href=/i);assert.equal(sniperInventory(value([{...r,binding:{state:'linked'}}])),null);assert.equal(sniperInventory(value([{...r,placement:'FIELD'}])),null);
});
