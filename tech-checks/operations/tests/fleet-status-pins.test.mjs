import test from 'node:test';import assert from 'node:assert/strict';
import {fleetAddressHealth,addressGroupHealth,addressPinStatusLabel,fleetUnitPinMarkup,fleetSourcePinMarkup,fleetGroupPinMarkup} from '../src/fleetStatusPins.ts';
const product=(id,state='online',unitId='unit-'+id)=>({productId:id,unitNumber:'Name is not an identity',state,unitId,recordId:null,reason:''});
const row=(id,state='online',extra={})=>({id:'unit-'+id,placement:'field',retired:false,cameraState:state,routerState:'offline',batteryState:'unknown',...extra});
const pin=(id,extra={})=>({productId:id,lifecycle:'UNFLAGGED',placementHeld:false,...extra});
test('reviewed Product ID/unit IDs retain independent layer states',()=>{
 const products=[product('1'),product('2','offline'),product('3','unverified')],rows=[row('1'),row('2','offline'),row('3','unknown')];
 assert.deepEqual([...fleetAddressHealth(products,rows,'camera').values()],['online','offline','unknown']);
 assert.deepEqual([...fleetAddressHealth(products,rows,'router').values()],['offline','offline','offline']);
 assert.deepEqual([...fleetAddressHealth(products,rows,'battery').values()],['unknown','unknown','unknown']);
});
for(const [label,products,rows] of [
 ['unlinked name match',[product('1','unlinked',null)],[row('1')]],['held identity',[product('1','review')],[row('1')]],['inactive source',[product('1','inactive')],[row('1')]],['absent unit',[product('1')],[]],['duplicate unit',[product('1')],[row('1'),row('1')]],['duplicate Product ID',[product('1'),product('1')],[row('1')]],['two products claim one unit',[product('1'),product('2','online','unit-1')],[row('1')]],['retired unit',[product('1')],[row('1','online',{retired:true})]],['Shop unit',[product('1')],[row('1','online',{placement:'shop'})]],['inconsistent observation',[product('1')],[row('1','offline')]],
])test(label+' cannot inherit green from an address or possible match',()=>assert.equal(fleetAddressHealth(products,rows,'camera').get('1'),'unknown'));
test('solar support stays blue without inventing camera health',()=>assert.equal(fleetAddressHealth([product('1','support',null)],[],'camera').get('1'),'support'));
test('address lookup evidence is independent; holds and unknown links stay gray; mixed groups remain mixed',()=>{
 const health=new Map([['1','online'],['2','offline'],['3','support']]);assert.equal(addressGroupHealth([pin('1',{state:'address_review'})],health).state,'online');
 for(const p of [pin('1',{placementHeld:true}),pin('1',{lifecycle:'DO_NOT_USE'}),pin('9')])assert.equal(addressGroupHealth([p],health).state,'unknown');
 const mixed=addressGroupHealth([pin('1'),pin('2'),pin('3')],health);assert.equal(mixed.state,'mixed');assert.equal(addressPinStatusLabel(mixed.counts),'1 online, 1 offline, 1 solar support');
});
test('individual Fleet pin drops retain state, numeric labels and HTML safety',()=>{
 for(const state of ['online','offline','unknown','support']){const m=fleetUnitPinMarkup('Ranger 029.2',state,'recorded');assert.match(m,/class="[^"]*cos-unit-pin-drop/);assert.match(m,/029.2/);assert.match(m,/SRC/);assert.match(m,new RegExp('data-health="'+state+'"'));}
 assert.match(fleetUnitPinMarkup('Sniper 4-100','offline'),/>4-100<\/b>/);
 assert.doesNotMatch(fleetUnitPinMarkup('<img src=x onerror=alert(1)>','online'),/<img|onerror/);assert.match(fleetSourcePinMarkup('ST 007'),/--pin:#94a3b8/);assert.match(fleetSourcePinMarkup('ST 007'),/class="[^"]*cos-unit-pin-drop/);
 const group=fleetGroupPinMarkup({online:1,offline:1,unknown:0,support:0});assert.match(group,/data-health="mixed"/);assert.match(group,/class="[^"]*cos-unit-pin-drop/);
 assert.match(fleetGroupPinMarkup({online:0,offline:0,unknown:0,support:0},0,0,0,2),/--pin:#94a3b8/);
});
