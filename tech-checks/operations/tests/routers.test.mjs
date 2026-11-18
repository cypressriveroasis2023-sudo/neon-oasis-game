import test from 'node:test';
import assert from 'node:assert/strict';
import { routerSnapshot, routerStatus, summarizeRouters, readRouterSnapshot, exactUnitName } from '../../supabase/functions/cos-operations-pages/routers.ts';
const now = new Date('2026-10-05T21:00:00Z');
const unit = {id:'11111111-1111-4111-8111-111111111111',unit_number:'HELIOS 001'};
const router = {id:1,unit_key:'HELIOS 001',router_name:'Test router',router_model:'IR302',web_port:8080,web_protocol:'http',current_status:'online',last_checked_at:'2026-10-05T20:59:00Z',last_online_at:'2026-09-10T10:00:00Z',reported_status:'online',status_observed_at:'2026-09-22T10:00:00Z',status_source:'inhand_export',reported_latency_ms:40};
const shapedAddress = () => [198, 51, 100, 24].join('.');
const shapedV6 = () => ['2001', 'db8', '0', '10'].join(':');
const networkKey = key => /ip|wan|lan/i.test(key);
const ipv4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?:\/\d{1,2})?\b/;
const ipv6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}\b/i;
function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => walk(item, visit));
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { visit(key, item); walk(item, visit); }
  }
}
const row = (patch={}) => routerSnapshot([{...router,...patch}],[unit],now).items[0];
test('fresh probe is reachable, failed probe is unreachable, imported online is never used',()=>{
 assert.equal(routerStatus(row(),+now),'reachable');
 assert.equal(routerStatus(row({current_status:'offline'}),+now),'unreachable');
 assert.equal(routerStatus(row({current_status:null,last_checked_at:null}),+now),'unknown');
 assert.equal(routerStatus(row({current_status:'offline',reported_status:'online'}),+now),'unreachable');
});
test('stale, absent, malformed and future probe timestamps cannot manufacture online',()=>{
 assert.equal(routerStatus(row({last_checked_at:'2026-10-05T20:39:59Z'}),+now),'stale');
 assert.equal(routerStatus(row({last_checked_at:'2026-10-05T20:40:00Z'}),+now),'reachable');
 assert.equal(routerStatus(row({last_checked_at:'2026-10-05T20:44:00Z'}),+now),'reachable');
 for(const value of [null,'nonsense','2026-10-05T21:00:01Z'])assert.equal(routerStatus(row({last_checked_at:value}),+now),'unknown');
});
test('freshness ages without another API response',()=>{
 const value=row();assert.equal(routerStatus(value,+now),'reachable');assert.equal(routerStatus(value,+now+21*60*1000),'stale');
});
test('summary keeps stale, unknown, reachability distinct',()=>{
 assert.deepEqual(summarizeRouters([row(),row({current_status:'offline'}),row({last_checked_at:null}),row({last_checked_at:'2026-09-22T00:00:00Z'})],+now),{reachable:1,unreachable:1,stale:1,unknown:1});
});
test('exact names tolerate only case and whitespace and remain suggestions',()=>{
 assert.equal(exactUnitName(' HELIOS   001 '),'helios 001');
 const value=routerSnapshot([{...router,unit_key:' helios  001 '}],[unit],now).items[0];assert.equal(value.match,'exact_name');assert.deepEqual(value.candidateUnit,{id:unit.id,unitNumber:unit.unit_number});
 for(const name of ['Helios 1','Helios-001','H001'])assert.equal(row({unit_key:name}).match,'unmatched');
});
test('duplicate router names and duplicate COS names never auto-link',()=>{
 const duplicates=routerSnapshot([router,{...router,id:2}],[unit],now);assert.ok(duplicates.items.every(row=>row.match==='ambiguous'&&row.candidateUnit===null));
 const duplicateUnits=routerSnapshot([router],[unit,{...unit,id:'other'}],now);assert.equal(duplicateUnits.items[0].match,'ambiguous');assert.equal(duplicateUnits.items[0].candidateUnit,null);
});
test('router response has no network-address keys or address-shaped values',()=>{
 const hidden = shapedAddress(), hiddenPrefix = hidden + '/32', hiddenV6 = shapedV6();
 const value = routerSnapshot([{...router, router_public_ip: hiddenPrefix, unit_ip: hidden, wan: hidden, lan: hiddenV6, private_ip: hidden, publicIp: hidden}], [unit], now);
 const encoded = JSON.stringify(value);
 assert.equal(encoded.includes(hidden), false);
 assert.equal(encoded.includes(hiddenV6), false);
 const keys = [];
 walk(value, key => keys.push(key));
 assert.equal(keys.some(networkKey), false);
 assert.equal(ipv4.test(encoded), false);
 assert.equal(ipv6.test(encoded), false);
 assert.equal(value.items[0].probeStatus, 'online');
 assert.equal(routerStatus(value.items[0], +now), 'reachable');
 assert.equal(routerStatus(routerSnapshot([{...router, current_status: null, last_checked_at: null, router_public_ip: hidden}], [unit], now).items[0], +now), 'unknown');
 const injected = routerSnapshot([router], [unit], now);
 injected.items[0].publicIp = hidden;
 injected.items[0].wan = hiddenV6;
 const read = readRouterSnapshot(injected);
 assert.equal(JSON.stringify(read).includes(hidden), false);
 assert.equal(JSON.stringify(read).includes(hiddenV6), false);
});
test('allowlist excludes credentials, metadata and any alleged GPS field',()=>{
 const value=row({latitude:30,longitude:-95,gps:{latitude:30,longitude:-95},password:'DO_NOT_EXPOSE',source_metadata:{token:'DO_NOT_EXPOSE'}});
 assert.equal(value.gps,null);assert.equal(JSON.stringify(value).includes('DO_NOT_EXPOSE'),false);assert.equal('latitude' in value,false);
 assert.equal(routerSnapshot([router],[unit],now).gpsAvailable,false);
});
test('recovery timestamp preserved with truthful name; invalid port rejected',()=>{
 assert.equal(row().lastRecoveredAt,router.last_online_at);assert.equal('lastSeenAt' in row(),false);
 for(const port of [0,65536,8080.5,'8080',null])assert.equal(row({web_port:port}).port,null);
 assert.equal(row({web_protocol:'javascript:'}).protocol,null);
});
test('malformed inventory fails closed and browser contract refuses GPS injection',()=>{
 assert.throws(()=>routerSnapshot([router,router],[unit],now));assert.throws(()=>routerSnapshot([{id:1}],[unit],now));
 const good=routerSnapshot([router],[unit],now);assert.equal(readRouterSnapshot(good),good);
 assert.throws(()=>readRouterSnapshot({...good,gpsAvailable:true}));assert.throws(()=>readRouterSnapshot({...good,items:[{...good.items[0],gps:{latitude:30,longitude:-95}}]}));
 assert.throws(()=>readRouterSnapshot({...good,items:[...good.items,...good.items]}));
 assert.throws(()=>readRouterSnapshot({...good,items:[{...good.items[0],match:'ambiguous'}]}));
});
