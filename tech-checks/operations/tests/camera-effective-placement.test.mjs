import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {setupFixture} from './camera-effective-placement.fixture.mjs';
function fixture(){const ctx=vm.createContext({Date,AbortController,setTimeout,clearTimeout});ctx.window=ctx;vm.runInContext('('+setupFixture.toString()+')()',ctx);for(const file of ['camera-placement-controls.js','camera-effective-placement.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),ctx);return ctx;}
test('same effective DTO drives FIELD, SHOP and Owner/GPS precedence without mutating observations',()=>{
 const c=fixture(),before=JSON.stringify(c.fixtureDevices),api=c.CameraEffectivePlacement;
 for(const mode of ['field','shop','owner']){c.fixtureMode=mode;const out=api.resolve(c.snapshotFixture(),c.healthFixture(),c.fixtureDevices),v=out.get('11');assert.equal(v.status,'ready');assert.equal(v.scope,mode==='shop'?'shop':'field');if(mode==='owner'){assert.equal(v.address,'99 Owner Road, Testville, TX 75001');assert.equal(v.row.latitude,32.123);assert.equal(v.source,'Owner-confirmed placement');}}
 assert.equal(JSON.stringify(c.fixtureDevices),before);
});
test('approved aliases and existing exact typed identifiers bind without inventing provider proof',()=>{
 const c=fixture(),api=c.CameraEffectivePlacement,s=c.snapshotFixture(),h=c.healthFixture();
 assert.equal(api.resolve(s,h,c.fixtureDevices).get('12').unitNumber,'SNIPER 312.2');
 h.unitIdentities=[];h.ownerConfirmedUnitIdentities=[];const result=api.resolve(s,h,c.fixtureDevices);assert.equal(result.get('11').identityBasis,'exact_full_identifier');assert.match(result.get('11').source,/Exact full unit identifier/);assert.equal(result.get('11').proof,null);
});
test('duplicates, changed complete source groups, warnings and mismatched Owner audit fail closed',()=>{
 const changes=[(s)=>{s.items[0].placementSource='owner';},(s)=>{s.items[0].currentLocationType=44;},(s)=>s.inventoryItems.push({...s.inventoryItems[0],id:'33333333-3333-4333-8333-333333333333'}),(s,h)=>h.unitIdentities.push({...h.unitIdentities[0]}),(s,h)=>h.rows.push({id:99,unit:'RANGER 022'}),(s,h)=>h.identityWarnings.push({unitId:s.items[0].id,reason:'changed',deviceIds:['11']}),(s,h)=>{h.unitIdentities[0].kind='owner_placement';h.unitIdentities[0].placementAuditId='101';},(s,h)=>s.placementReviews.push({unitId:s.items[0].id,unitNumber:'RANGER 022'})];
 for(const change of changes){const c=fixture(),s=c.snapshotFixture(),h=c.healthFixture();change(s,h);assert.equal(c.CameraEffectivePlacement.resolve(s,h,c.fixtureDevices).get('11').status,'unresolved');}
 const c=fixture(),s=c.snapshotFixture(),h=c.healthFixture();h.rows.push({...h.rows[0]});assert.throws(()=>c.CameraEffectivePlacement.resolve(s,h,c.fixtureDevices),/duplicated/);
});
test('stale, incomplete and inconsistent snapshots are never current; exact leading-zero variants remain intact',()=>{
 const c=fixture(),api=c.CameraEffectivePlacement,s=c.snapshotFixture(),h=c.healthFixture();s.generatedAt='2001-01-01T00:00:00Z';assert.throws(()=>api.resolve(s,h,c.fixtureDevices),/stale/);
 const bad=c.snapshotFixture();bad.items[0]={...bad.items[0],address:'wrong'};assert.throws(()=>api.resolve(bad,h,c.fixtureDevices),/inconsistent/);
 h.ownerConfirmedUnitIdentities[0].unitKeys=['SNIPER 312.2'];assert.equal(api.resolve(c.snapshotFixture(),h,c.fixtureDevices).get('12').status,'unresolved');
});
test('bounded read preserves last fields with explicit stale state; changed subject clears data',async()=>{
 const c=fixture(),api=c.CameraEffectivePlacement;let deny=false;
 c.fetch=async(_u,options)=>({ok:!deny,json:async()=>JSON.parse(options.body).path==='/api/field-map'?c.snapshotFixture():c.healthFixture()});
 const view=api.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await view.refresh();assert.equal(view.get(c.fixtureDevices[0]).status,'ready');deny=true;await view.refresh();assert.equal(view.get(c.fixtureDevices[0]).status,'stale');assert.match(api.locationText(c.fixtureDevices[0]),/10 Source Road/);c.authChange('SIGNED_OUT',null);assert.equal(view.get(c.fixtureDevices[0]).status,'unavailable');assert.doesNotMatch(api.locationText(c.fixtureDevices[0]),/10 Source Road/);view.dispose();
});
test('late older source response cannot replace a newer placement or different resource',async()=>{
 const c=fixture();let release,first=true;const old=c.snapshotFixture();c.fetch=async(_u,o)=>{const path=JSON.parse(o.body).path;if(path==='/api/field-map'&&first){first=false;await new Promise(r=>release=r);return {ok:true,json:async()=>old};}return{ok:true,json:async()=>path==='/api/field-map'?c.snapshotFixture():c.healthFixture()};};
 const v=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});const pending=v.refresh();await new Promise(r=>setTimeout(r,0));c.fixtureMode='shop';await v.refresh();assert.equal(v.get(c.fixtureDevices[0]).status,'unavailable');release();await pending;await new Promise(r=>setTimeout(r,0));assert.equal(v.get(c.fixtureDevices[0]).status,'unavailable');await v.refresh();assert.equal(v.get(c.fixtureDevices[0]).scope,'shop');c.fixtureDevices[0]={...c.fixtureDevices[0],unit_key:'RANGER 099'};assert.notEqual(v.get(c.fixtureDevices[0]).status,'ready');v.dispose();
});
test('an unresponsive session read becomes bounded unavailable without producing empty editable placement',async()=>{
 const c=fixture(),v=c.CameraEffectivePlacement.create({db:{auth:{getSession:()=>new Promise(()=>{})}},getDevices:()=>c.fixtureDevices,timeoutMs:5});await v.refresh();assert.equal(v.get(c.fixtureDevices[0]).status,'unavailable');assert.match(v.get(c.fixtureDevices[0]).reason,/unavailable/);v.dispose();
});

test('Owner-confirmed extension stays separate from v1 identities and rejects partial/version mismatches',()=>{
 for(const mutate of [h=>h.ownerConfirmedIdentityVersion=2,h=>delete h.ownerConfirmedIdentityVersion,h=>h.unitIdentities.push(h.ownerConfirmedUnitIdentities[0])]){const c=fixture(),h=c.healthFixture();mutate(h);assert.throws(()=>c.CameraEffectivePlacement.resolve(c.snapshotFixture(),h,c.fixtureDevices),/identity contract/);}
});

test('exact fallback rejects competing aliases, full-family duplicates, existing claims, review warnings and bare numbers',()=>{
 const changes=[(c,s,h)=>h.rows.push({id:99,unit:'RANGER 22'}),(c,s,h)=>s.inventoryItems.push({...s.inventoryItems[0],id:'33333333-3333-4333-8333-333333333333',unitNumber:'RANGER 22'}),(c,s,h)=>h.identityWarnings.push({unitId:s.items[0].id,reason:'revoked',unitKeys:['RANGER 022']}),(c,s,h)=>{h.unitIdentities=[{unitId:s.items[0].id,unitNumber:'RANGER 022',kind:'native_provider',deviceIds:['12'],unitKeys:['SNIPER 00312.2'],proof:'a'.repeat(64)}];},(c,s,h)=>{c.fixtureDevices[0].unit_key='022';h.rows[0].unit='022';s.items[0].unitNumber='022';}];
 for(const change of changes){const c=fixture(),s=c.snapshotFixture(),h=c.healthFixture();h.unitIdentities=[];h.ownerConfirmedUnitIdentities=[];change(c,s,h);assert.equal(c.CameraEffectivePlacement.resolve(s,h,c.fixtureDevices).get('11').status,'unresolved');}
});

test('a previously unresolved source group never becomes last-read FIELD after a denied refresh',async()=>{
 const c=fixture();let deny=false;c.fetch=async(_u,o)=>({ok:!deny,json:async()=>JSON.parse(o.body).path==='/api/field-map'?c.snapshotFixture():c.healthFixture()});const v=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await v.refresh();assert.equal(v.get(c.fixtureDevices[2]).status,'unresolved');deny=true;await v.refresh();assert.equal(v.get(c.fixtureDevices[2]).status,'unavailable');assert.doesNotMatch(c.CameraEffectivePlacement.locationText(c.fixtureDevices[2]),/FIELD/);v.dispose();
});
test('a valid Owner-confirmed alias may bind an otherwise unparseable source label only through its explicit resource proof',()=>{
 const c=fixture(),h=c.healthFixture();c.fixtureDevices[1].unit_key='Approved legacy source label';h.rows[1].unit='Approved legacy source label';h.ownerConfirmedUnitIdentities[0].unitKeys=['Approved legacy source label'];assert.equal(c.CameraEffectivePlacement.resolve(c.snapshotFixture(),h,c.fixtureDevices).get('12').identityBasis,'owner_confirmed_native');h.ownerConfirmedUnitIdentities=[];assert.equal(c.CameraEffectivePlacement.resolve(c.snapshotFixture(),h,c.fixtureDevices).get('12').status,'unresolved');
});
test('SHOP labels exclude a retained historical field address without modifying its DTO or raw record',async()=>{
 const c=fixture();c.fixtureMode='shop';const old=c.snapshotFixture;c.snapshotFixture=()=>{const snapshot=old();snapshot.inventoryItems[0].address='2045 Historical Field Rd, Testville, TX 75001';snapshot.inventoryItems[0].site='Old Customer Site';return snapshot;};let deny=false;c.fetch=async(_u,o)=>({ok:!deny,json:async()=>JSON.parse(o.body).path==='/api/field-map'?c.snapshotFixture():c.healthFixture()});const view=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await view.refresh();assert.equal(c.CameraEffectivePlacement.locationText(c.fixtureDevices[0]),'SHOP / ROOT');assert.equal(view.get(c.fixtureDevices[0]).row.address,'2045 Historical Field Rd, Testville, TX 75001');assert.equal(view.get(c.fixtureDevices[0]).row.site,'Old Customer Site');deny=true;await view.refresh();assert.equal(c.CameraEffectivePlacement.locationText(c.fixtureDevices[0]),'Last read: SHOP / ROOT');assert.equal(view.get(c.fixtureDevices[0]).row.address,'2045 Historical Field Rd, Testville, TX 75001');assert.equal(view.get(c.fixtureDevices[0]).row.site,'Old Customer Site');view.dispose();
});

for(const failedPath of ['/api/field-map','/api/camera-health/summary-v3'])for(const failure of ['http','body'])test('terminal '+failedPath+' '+failure+' failure aborts the sibling saved read',async()=>{
 const c=fixture(),signals=[];let siblingAborted=false;
 c.fetch=async(_u,options)=>{const path=JSON.parse(options.body).path;signals.push(options.signal);if(path===failedPath)return {ok:failure!=='http',status:503,json:async()=>{throw Error('Synthetic response body failed');}};
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{siblingAborted=true;reject(Error('Synthetic sibling cancelled'));},{once:true}));};
 const view=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await view.refresh();
 assert.equal(signals.length,2);assert.equal(siblingAborted,true);assert.ok(signals.every(signal=>signal.aborted));assert.equal(view.get(c.fixtureDevices[0]).status,'unavailable');view.dispose();
});
test('display timeout aborts both pending transports without extending its deadline',async()=>{
 const c=fixture(),signals=[];c.fetch=async(_u,options)=>{signals.push(options.signal);return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Synthetic timed-out transport')),{once:true}));};
 const view=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices,timeoutMs:5});await view.refresh();assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));assert.equal(view.get(c.fixtureDevices[0]).status,'unavailable');view.dispose();
});
test('successful display cleanup aborts its completed attempt without changing ready evidence',async()=>{
 const c=fixture(),signals=[];c.fetch=async(_u,options)=>{signals.push(options.signal);return {ok:true,json:async()=>JSON.parse(options.body).path==='/api/field-map'?c.snapshotFixture():c.healthFixture()};};
 const view=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await view.refresh();assert.ok(signals.every(signal=>signal.aborted));assert.equal(view.get(c.fixtureDevices[0]).status,'ready');view.dispose();
});
test('superseded display cleanup keeps the draining barrier until the old bodies settle',async()=>{
 const c=fixture(),signals=[],releases=[];c.fetch=async(_u,options)=>{const path=JSON.parse(options.body).path;signals.push(options.signal);await new Promise(resolve=>releases.push(resolve));return {ok:true,json:async()=>path==='/api/field-map'?c.snapshotFixture():c.healthFixture()};};
 const view=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices}),older=view.refresh();await new Promise(resolve=>setTimeout(resolve,0));await view.refresh();await older;
 assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));assert.equal(view.get(c.fixtureDevices[0]).status,'unavailable');releases.forEach(resolve=>resolve());await new Promise(resolve=>setTimeout(resolve,0));assert.equal(view.get(c.fixtureDevices[0]).status,'unavailable');
 const newer=view.refresh();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(signals.length,4);assert.ok(signals.slice(2).every(signal=>!signal.aborted));releases.slice(2).forEach(resolve=>resolve());await newer;assert.equal(view.get(c.fixtureDevices[0]).status,'ready');view.dispose();
});
test('canonical source fence rejects split map/summary authority and compares retained native authority',()=>{
 const c=fixture(),api=c.CameraEffectivePlacement,s=c.snapshotFixture(),h=c.healthFixture();
 const a={contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'tenant',generation:'1',rosterRevision:'roster',admitted:true};
 s.avigilonAuthority={...a};h.avigilonAuthority={...a};const v=api.sourceVersion(s,h);
 assert.equal(api.authorityMatches(v,a),true);assert.equal(api.authorityMatches(v,{...a,generation:'2'}),false);assert.equal(api.authorityMatches(v,null),false);
 h.avigilonAuthority={...a,generation:'2'};assert.throws(()=>api.sourceVersion(s,h),/authority changed/);
 h.avigilonAuthority={...a,admitted:false};assert.throws(()=>api.sourceVersion(s,h),/authority changed/);
 delete h.avigilonAuthority;assert.throws(()=>api.sourceVersion(s,h),/authority changed/);
});
test('canonical source comparison ignores recursive key order but detects inventory placement changes',()=>{
 const c=fixture(),api=c.CameraEffectivePlacement,s=c.snapshotFixture(),h=c.healthFixture();
 const a={contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'tenant',generation:'1',rosterRevision:'roster',admitted:true};s.avigilonAuthority=a;h.avigilonAuthority=a;
 const before=api.sourceVersion(s,h);const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert.equal(api.versionEqual(before,api.sourceVersion(reorder(s),reorder(h))),true);
 s.inventoryItems[0].address='Changed location';assert.equal(api.versionEqual(before,api.sourceVersion(s,h)),false);assert.equal(api.versionEqual(null,null),false);
});
test('explicit invalidation removes authority immediately while retaining saved location as stale',async()=>{
 const c=fixture();c.fetch=async(_u,o)=>({ok:true,json:async()=>JSON.parse(o.body).path==='/api/field-map'?c.snapshotFixture():c.healthFixture()});
 const api=c.CameraEffectivePlacement,v=api.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});await v.refresh();assert.equal(v.state(),'ready');assert.ok(v.version());v.invalidate();assert.equal(v.version(),null);assert.equal(v.state(),'stale');assert.match(api.locationText(c.fixtureDevices[0]),/10 Source Road/);v.dispose();
});
