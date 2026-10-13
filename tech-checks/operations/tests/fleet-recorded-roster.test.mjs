import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readRecordedRoster,filterSourceEquipment} from '../src/fleetRecordedRoster.ts';
import {initialFleetFilters} from '../src/fleetDashboardModel.ts';
import FleetSourceEquipment from '../src/FleetSourceEquipment.tsx';
import {recordedRoster} from './fixtures/recorded-roster-fixtures.mjs';
const now=Date.parse('2026-10-13T18:00:00Z'),fresh=new Date(now-60000).toISOString();
const units=[{id:'00000000-0000-4000-8000-000000000001',unitNumber:'Helios 1',currentLocationType:'field'}];
const fixture=()=>recordedRoster(units,fresh);

test('combined roster is one typed population with source equipment separate from UUID units',()=>{
 const value=fixture(),{roster,error}=readRecordedRoster(value);assert.equal(error,null);assert.equal(roster,value);assert.equal(roster.summary.field,3);assert.equal(filterSourceEquipment(roster.items,initialFleetFilters).length,2);assert(filterSourceEquipment(roster.items,initialFleetFilters).every(row=>row.unitId===null));assert.equal(readRecordedRoster(undefined).error,null);
});
for(const kind of ['duplicate record','duplicate UUID','invented UUID','count mismatch','unknown contract','invalid timestamp'])test('invalid roster cannot supply trusted counts: '+kind,()=>{
 const value=fixture();if(kind==='duplicate record')value.items[1].id=value.items[0].id;if(kind==='duplicate UUID')value.items.push({...value.items[0],id:'cos_unit:another'});if(kind==='invented UUID')value.items[1].unitId=units[0].id;if(kind==='count mismatch')value.summary.field++;if(kind==='unknown contract')value.contract='other';if(kind==='invalid timestamp')value.items[1].observedAt='yesterday';const result=readRecordedRoster(value);assert.equal(result.roster,null);assert.match(result.error,/could not be verified/);
});
test('source filters preserve field/shop/held and lifecycle distinctions without inventing health or nearby positions',()=>{
 const items=fixture().items;assert.equal(filterSourceEquipment(items,{...initialFleetFilters,status:'online'}).length,0);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,status:'unknown'}).length,2);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,retired:true}).length,3);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,placement:'shop'}).length,1);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,placement:'unknown'})[0].kind,'identity_review');assert.equal(filterSourceEquipment(items,{...initialFleetFilters,nearbyId:units[0].id}).length,0);assert.equal(filterSourceEquipment(items,initialFleetFilters,'verify').length,0);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,query:'Ranger 901'}).length,1);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,family:'RECON2'}).length,1);
});
test('source card is read-only, clearly unlinked and never turns customer address into installation evidence',()=>{
 const item=fixture().items[1],html=renderToStaticMarkup(React.createElement(FleetSourceEquipment,{record:item,now}));assert.match(html,/Recorded FIELD/);assert.match(html,/Health unlinked/);assert.match(html,/MHelp address: 555 Synthetic customer address/);assert.match(html,/MHelp product record: 7001/);assert.match(html,/No map pin or installation edit/);assert.doesNotMatch(html,/data-unit-id|href=|<button|Online|latitude|longitude/);
});

test('identity-review source placement is visible but excluded from confirmed field and health',()=>{
 const value=fixture(),record=value.items.find(r=>r.kind==='identity_review');Object.assign(record,{recordedSourcePlacement:'field',candidateUnitIds:[units[0].id],candidatePlacements:[{unitId:units[0].id,unitNumber:'Helios 1',placement:'shop',source:'owner',observedAt:fresh}]});assert.equal(readRecordedRoster(value).error,null);assert(!filterSourceEquipment(value.items,initialFleetFilters).includes(record));const html=renderToStaticMarkup(React.createElement(FleetSourceEquipment,{record,now}));assert.match(html,/Source assignment: FIELD/);assert.match(html,/excluded from confirmed placement totals/);assert.match(html,/recorded SHOP/);assert.match(html,new RegExp(units[0].id));assert.doesNotMatch(html,/data-unit-id|href=|<button/);
});
test('alias display stays separate from source identity and all summary dimensions are checked',()=>{
 const value=fixture();value.items[1].displayUnitNumber='Ranger 901.1';assert.equal(readRecordedRoster(value).error,null);assert.equal(value.items[1].unitNumber,'Ranger 901');assert.match(renderToStaticMarkup(React.createElement(FleetSourceEquipment,{record:value.items[1],now})),/Ranger 901.1/);assert.equal(filterSourceEquipment(value.items,{...initialFleetFilters,query:'901.1'}).length,1);for(const key of ['review','excludedLifecycle','sourceOnlyRecords','linkedUnitRecords']){const bad=structuredClone(value);bad.summary[key]++;assert(readRecordedRoster(bad).error);}
});

test('canonical UUID inventory must be the same roster population, never an extra parallel count',()=>{
 const value=fixture();assert.equal(readRecordedRoster(value,units).error,null);assert(readRecordedRoster(value,[]).error);assert(readRecordedRoster(value,[...units,{...units[0],id:'00000000-0000-4000-8000-000000000002'}]).error);assert(readRecordedRoster(value,[{...units[0],unitNumber:'Helios 99'}]).error);const inactive=structuredClone(value);inactive.items[1].lifecycle='do_not_use';assert(readRecordedRoster(inactive).error);
});

test('linked placement and active eligibility cannot disagree between roster and canonical inventory',()=>{
 const value=fixture(),bad=structuredClone(value);bad.items[0].placement='shop';bad.summary.field--;bad.summary.shop++;assert(readRecordedRoster(bad).error);assert(readRecordedRoster(value,[{...units[0],currentLocationType:'shop'}]).error);const inactive=structuredClone(value);inactive.items[0].unit.activeInventoryEligible=false;assert(readRecordedRoster(inactive).error);assert(readRecordedRoster(value,[{...units[0],activeInventoryEligible:false}]).error);
});

test('identity review cannot be relabeled FIELD or SHOP even with matching recomputed totals',()=>{
 for(const placement of ['field','shop']){const value=fixture(),record=value.items.find(r=>r.kind==='identity_review');record.placement=placement;value.summary.review--;value.summary[placement]++;assert(readRecordedRoster(value).error);}
});

test('Field setup excludes Shop ROOT, unresolved placement and inactive records without hiding them from inventory',()=>{const items=fixture().items,filters={...initialFleetFilters,placement:'all',retired:true};const setup=filterSourceEquipment(items,filters,'setup');assert.equal(setup.length,2);assert(setup.every(r=>r.active&&r.placement==='field'));assert.equal(filterSourceEquipment(items,{...initialFleetFilters,placement:'shop'}).length,1);assert.equal(filterSourceEquipment(items,{...initialFleetFilters,placement:'unknown'}).length,1);});
