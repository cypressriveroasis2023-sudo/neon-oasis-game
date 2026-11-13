import test from 'node:test';
import assert from 'node:assert/strict';
import {unitPins,PIN_COLOUR} from '../src/unitStatusPins.ts';

const unit=(over={})=>({unit:'SPOTTER 306',placement:'FIELD',site:'A Site',state:'GREEN',cameras:2,online:2,offline:0,unknown:0,down:[],
 onlineInShop:false,publicIp:null,observedAt:null,siteNamePending:false,address:'1 Main St, Houston, TX 77002',
 location:{latitude:29.76,longitude:-95.36,matchedAddress:null,source:'hand'},...over});

test('one pin per field unit with a recorded point, coloured by its camera status',()=>{
 const {pins,fieldUnits,withoutPin}=unitPins([
  unit(),unit({unit:'RANGER 014',state:'RED'}),unit({unit:'HELIOS 001',state:'YELLOW'}),unit({unit:'SPOTTER 264',state:'UNKNOWN'})]);
 assert.equal(fieldUnits,4);assert.equal(withoutPin,0);
 assert.deepEqual(pins.map(p=>[p.unit,p.colour]),[['SPOTTER 306',PIN_COLOUR.GREEN],['SPOTTER 264',PIN_COLOUR.UNKNOWN],['HELIOS 001',PIN_COLOUR.YELLOW],['RANGER 014',PIN_COLOUR.RED]],
  'red draws last so it is never hidden');
 assert.notEqual(PIN_COLOUR.YELLOW,PIN_COLOUR.RED);
});

test('no point, no pin; shop units are never pinned; the count says how many lack an address',()=>{
 const {pins,fieldUnits,withoutPin}=unitPins([unit({location:null}),unit({unit:'SS058',placement:'SHOP'}),
  unit({unit:'X1',location:{latitude:NaN,longitude:1}}),unit({unit:'X2',location:{latitude:'29',longitude:'-95'}})]);
 assert.equal(pins.length,0);assert.equal(fieldUnits,3);assert.equal(withoutPin,3);
});
