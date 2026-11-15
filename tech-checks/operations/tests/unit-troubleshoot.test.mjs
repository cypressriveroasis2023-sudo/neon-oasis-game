import {test} from 'node:test';
import assert from 'node:assert/strict';
import {troubleshootUnit} from '../src/unitTroubleshoot.ts';

const unit=(extra={})=>({unit:'SOLARSPOTTER 006',displayName:'SOLARSPOTTER 006',placement:'FIELD',
 site:'Blazer SW',state:'GREEN',cameras:5,online:5,offline:0,unknown:0,down:[],onlineInShop:false,
 publicIp:'198.51.100.7',observedAt:'2026-11-15T19:00:00Z',address:'1 Main St',
 location:{latitude:29.7,longitude:-95.4},...extra});
const find=(r,id)=>r.checks.find(c=>c.id===id);

test('a healthy unit passes and says so plainly', () => {
 const r=troubleshootUnit(unit(),{routerLinked:true,portsAnswered:[true,true],ipAnswered:true,mhelpSeenAt:'1:14'});
 assert.equal(r.failures,0);
 assert.match(r.advice,/checks out/);
});

test('a router answering is never proof the cameras work', () => {
 const r=troubleshootUnit(unit({state:'RED',online:0,offline:5}),{routerLinked:true});
 assert.equal(find(r,'router').verdict,'pass');
 assert.equal(find(r,'cameras').verdict,'fail');
 assert.match(find(r,'router').detail,/not proof the cameras work/);
 assert.match(r.advice,/Every camera/);
});

test('a check that was not made is Unknown, never a fault', () => {
 const r=troubleshootUnit(unit(),{});
 for(const id of ['router','ports','mhelp'])assert.equal(find(r,id).verdict,'unknown',id);
 assert.equal(r.failures,0);
});

test('silence from the provider is not an outage', () => {
 const r=troubleshootUnit(unit({state:'UNKNOWN'}),{});
 assert.equal(find(r,'cameras').verdict,'unknown');
 assert.match(r.advice,/not the same as it being down/);
 assert.ok(!/down\b.*swap/i.test(r.advice));
});

test('a shop unit is never called a customer outage', () => {
 const r=troubleshootUnit(unit({placement:'SHOP',state:'RED',online:0,offline:5}),{});
 assert.equal(find(r,'placement').verdict,'warn');
 assert.match(r.advice,/in the shop/);
 assert.match(r.advice,/not a customer outage|manual review/);
});

test('some cameras down points at swapping the one that is out', () => {
 const r=troubleshootUnit(unit({state:'YELLOW',online:4,offline:1,down:[{name:'SS006_3'}]}),{});
 assert.equal(find(r,'cameras').verdict,'fail');
 assert.match(find(r,'cameras').detail,/4 of 5 reporting/);
 assert.match(find(r,'cameras').detail,/SS006_3/);
 assert.match(r.advice,/Swap the one that is out/);
});

test('no address on file is a failure with an action', () => {
 const r=troubleshootUnit(unit({address:null,location:null}),{});
 assert.equal(find(r,'address').verdict,'fail');
 assert.equal(find(r,'address').action.id,'address');
 assert.match(r.advice,/no address on file/);
});

test('an address that has not pinned warns rather than failing', () => {
 const r=troubleshootUnit(unit({location:null}),{});
 assert.equal(find(r,'address').verdict,'warn');
 assert.match(find(r,'address').detail,/not on the map/);
});

test('a mostly unchecked unit is not reported as healthy', () => {
 const r=troubleshootUnit(unit(),{});
 assert.equal(r.failures,0);
 assert.ok(r.unknowns>=3);
 assert.match(r.advice,/not a clean bill of health/);
});

test('ports partly answering is a warning, not a pass', () => {
 const r=troubleshootUnit(unit(),{portsAnswered:[true,false]});
 assert.equal(find(r,'ports').verdict,'warn');
 assert.match(find(r,'ports').detail,/1 of 2 answered/);
});

test('a single camera unit does not say all 1 cameras', () => {
 const r=troubleshootUnit(unit({cameras:1,online:1}),{});
 assert.match(find(r,'cameras').detail,/all 1 camera reporting/);
 assert.ok(!/1 cameras/.test(find(r,'cameras').detail));
});

test('every check carries a verdict and words of its own', () => {
 const r=troubleshootUnit(unit(),{routerLinked:false,portsAnswered:[true],ipAnswered:true});
 assert.equal(r.checks.length,8);
 for(const c of r.checks){
  assert.ok(c.label&&c.detail,c.id);
  assert.ok(['pass','fail','warn','unknown'].includes(c.verdict),c.id);
 }
});
