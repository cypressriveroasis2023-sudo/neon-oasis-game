import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetVerificationBlockers} from '../src/fleetCommandCenterModel.ts';

const product=(status,linked,lifecycle='UNFLAGGED')=>({status,linked,lifecycle});

test('Fleet separates unknown identity, missing provider evidence and inactive source records',()=>{
 const products=[
  product('unverified',null),
  product('unverified',{state:'review',unitId:null}),
  product('unverified',{state:'unlinked',unitId:null}),
  product('unverified',{state:'unverified',unitId:'approved-unit-1'}),
  product('unverified',{state:'online',unitId:'approved-unit-2'}), // Victron power still unverified
  product('unverified',{state:'inactive',unitId:null},'DO_NOT_USE'),
  product('online',{state:'online',unitId:'approved-unit-3'}),
  product('offline',{state:'offline',unitId:'approved-unit-4'})
 ];
 assert.deepEqual(fleetVerificationBlockers(products),{identity:3,provider:2,inactive:1});
 assert.deepEqual(fleetVerificationBlockers([]),{identity:0,provider:0,inactive:0});
});

test('Unknown statuses do not become online or offline during blocker classification',()=>{
 const products=[product('unverified',{state:'unverified',unitId:'verified-product'})];
 const original=structuredClone(products);
 fleetVerificationBlockers(products);
 assert.deepEqual(products,original);
 assert.equal(products[0].status,'unverified');
});
