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
 const v=c.CameraEffectivePlacement.create({db:c.supabase.createClient(),getDevices:()=>c.fixtureDevices});const pending=v.refresh();await new Promise(r=>setTimeout(r,0));c.fixtureMode='shop';await v.refresh();release();await pending;assert.equal(v.get(c.fixtureDevices[0]).scope,'shop');c.fixtureDevices[0]={...c.fixtureDevices[0],unit_key:'RANGER 099'};assert.notEqual(v.get(c.fixtureDevices[0]).status,'ready');v.dispose();
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
