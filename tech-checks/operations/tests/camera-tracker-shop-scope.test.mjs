import test from 'node:test';
import {projectMhelpCameraPlacement,projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import assert from 'node:assert/strict';
import {projectTrackerShopScope,currentTrackerShopScope} from '../../supabase/functions/cos-operations-pages/cameraTrackerShopScope.ts';
import {cameraSummary,classifyCameraUnit} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fixture,clone,now,ID,ORG,mhelpReceiptFor} from './camera-tracker-shop-fixtures.mjs';
const run=f=>projectTrackerShopScope(f.summary,f.tracker,f.before,f.after);
for(const [name,family,tag,kind] of [['Helios 990001','Helios','990001','equipment_unit'],['Spotter 990018','Spotter','990018','equipment_unit'],['Spotter 990035','Spotter','990035','equipment_unit'],['Recon 990142','Recon','990142','tracker'],['Ranger 990099','Ranger','990099','equipment_unit']])test('retains '+name+' as SHOP inventory without name hardcoding',()=>{
 const f=fixture(name,family,tag,kind),old=clone(f),out=run(f);assert.equal(out.rows.length,1);assert.equal(out.rows[0].scope,'shop');assert.deepEqual({...out.rows[0],scope:'unknown'},f.summary.rows[0]);assert.equal(out.shopRoot,1);assert.equal(out.inventory.unknownScopeRecords,0);assert.equal(out.totalDevices,1);assert.equal(out.online,0);assert.equal(out.offline,0);assert.deepEqual(f,old);
});
const mutations={
 'missing source':f=>f.after.sources=[],
 'changed source revision':f=>f.after.sources[0].sourceRevision='44444444-4444-4444-8444-444444444444',
 'changed source row hash':f=>f.after.sources[0].sourceRowSha256='d'.repeat(64),
 'changed native guard':f=>f.after.sources[0].nativeGuardSha256='d'.repeat(64),
 'missing source registry identity':f=>delete f.after.sources[0].nativeSourceIdentity,
 'mismatched tracker registry ID':f=>f.after.sources[0].nativeSourceIdentity.trackerId='55555555-5555-4555-8555-555555555555',
 'wrong organization':f=>f.after.sources[0].organizationId='55555555-5555-4555-8555-555555555555',
 'unreviewed source schema':f=>f.after.sources[0].schemaVersion=2,
 'new FIELD source':f=>f.after.sources[0].placement='FIELD',
 'non-tombstone source':f=>f.after.sources[0].eligibility='FIELD',
 'malformed source revision':f=>f.after.sources[0].sourceRevision='bad',
 'unverified source override':f=>f.after.sources[0].sourcePrecedence={},
 'duplicate source':f=>f.after.sources.push(clone(f.after.sources[0])),
 'duplicate native inventory':f=>f.after.inventory.push(clone(f.after.inventory[0])),
 'second full typed unit':f=>f.after.inventory.push({...f.after.inventory[0],id:'55555555-5555-4555-8555-555555555555',readOnly:true}),
 'variant sibling':f=>f.after.inventory.push({...f.after.inventory[0],id:'55555555-5555-4555-8555-555555555555',unitNumber:'Helios 990001HDC2',readOnly:true}),
 'current Owner placement':f=>f.after.inventory[0].placementSource='owner',
 'current Owner audit ID':f=>f.after.inventory[0].placementAuditId='990000003',
 'current placement identity review':f=>f.after.inventory[0].placementStatus='needs_identity_review',
 'current GPS':f=>f.after.inventory[0].hasUnitGps=true,
 'current Owner-verified location':f=>f.after.inventory[0].locationVerification='owner_verified',
 'current installed site':f=>f.after.inventory[0].installedSiteId='55555555-5555-4555-8555-555555555555',
 'changed native UUID':f=>f.after.nativeUnits[0].id='55555555-5555-4555-8555-555555555555',
 'changed native label':f=>f.after.nativeUnits[0].unit_number='Helios 990002',
 'changed native operator status':f=>f.after.nativeUnits[0].status='installed',
 'changed inventory placement evidence':f=>f.after.inventory[0].placement='FIELD',
 'new current camera resource':f=>f.after.devices.push({id:90,unit_key:'HELIOS 990001',activation_state:'active'}),
 'new current camera variant':f=>f.after.devices.push({id:90,unit_key:'HELIOS 990001HDC4',activation_state:'deactivated'}),
 'duplicate unrelated camera IDs':f=>f.after.devices.push({id:90,unit_key:'Ranger 990999'},{id:'90',unit_key:'Ranger 990999'}),
 'malformed unrelated camera ID':f=>f.after.devices.push({id:'invalid',unit_key:'Ranger 990999'}),
 'duplicate unrelated audit IDs':f=>f.after.audits.push({id:90,unit_key:'Ranger 990999',device_ids:[]},{id:'90',unit_key:'Ranger 990999',device_ids:[]}),
 'malformed unrelated audit resource IDs':f=>f.after.audits.push({id:90,unit_key:'Ranger 990999',device_ids:['invalid']}),
 'new Owner FIELD move':f=>f.after.audits.push({id:90,unit_key:'HELIOS 990001',action:'MOVE_TO_FIELD',device_ids:[]}),
 'older unmarked Root audit':f=>f.before.audits.push({id:90,unit_key:'HELIOS 990001',action:'MOVE_TO_ROOT',device_ids:[]}),
 'new identity warning':f=>f.after.identity.identityWarnings.push({unitId:ID,unitKeys:[],deviceIds:[]}),
 'new provider association':f=>f.after.identity.unitIdentities.push({unitId:ID,unitKeys:['HELIOS 990001'],deviceIds:['90']}),
 'new unreviewed durable provider match':f=>f.after.matches.push({id:'66666666-6666-4666-8666-666666666666',equipment_unit_id:ID}),
 'revoked Owner claim remains a hold':f=>f.after.ownerClaims.push({id:'66666666-6666-4666-8666-666666666666',native_unit_id:ID,legacy_unit_key:'Former other label',status:'revoked'}),
 'new owner-confirmed association':f=>Object.assign(f.after.identity,{ownerConfirmedIdentityVersion:1,ownerConfirmedUnitIdentities:[{unitId:ID,unitKeys:['HELIOS 990001'],deviceIds:['90']}]}),
 'partial owner identity envelope':f=>f.after.identity.ownerConfirmedUnitIdentities=[],
 'tracker duplicate':f=>f.tracker.push(clone(f.tracker[0])),
 'malformed tracker':f=>delete f.tracker[0].unit_tag,
 'internally contradictory PDF family':f=>{f.tracker[0].canonical_family='Ranger';f.summary.rows[0].id='tracker:ranger|990001';},
 'internally contradictory PDF tag':f=>{f.tracker[0].unit_tag='990002';f.summary.rows[0].id='tracker:helios|990002';},
 'same canonical PDF identity different unparseable label':f=>f.tracker.push({...f.tracker[0],source_label:'Legacy untyped label',tracker_state:'shop'}),
 'inconsistent inventory count':f=>f.summary.inventory.allRecords++,
 'unknown inventory counter':f=>delete f.summary.inventory.unknownScopeRecords,
 'non-placeholder string ID':f=>f.summary.rows[0].id='field:'+ID,
 'real device ID':f=>f.summary.rows[0].id=90,
 'real resource flag':f=>delete f.summary.rows[0].trackerOnly,
 'provider status evidence':f=>f.summary.rows[0].status='online',
 'native label only without durable binding':f=>f.after.sources[0].nativeUnitId='55555555-5555-4555-8555-555555555555',
};
for(const [name,mutate] of Object.entries(mutations))test(name+' keeps original unresolved summary',()=>{const f=fixture();mutate(f);assert.strictEqual(run(f),f.summary);});
test('exact typed normalization cannot cross family or suffix boundaries',()=>{
 for(const changed of ['Solar Spotter 990018','Spotter 990018HDC2','990018']){const f=fixture('Spotter 990018','Spotter','990018');f.summary.rows[0].unit=changed;assert.strictEqual(run(f),f.summary);}
});
test('related Recon II evidence vetoes an ambiguous Recon I placeholder',()=>{const f=fixture('Recon 990142','Recon','990142','tracker');f.after.devices.push({id:50,unit_key:'RII-990142'});assert.strictEqual(run(f),f.summary);});
test('actual camera rows, provider status, historical detector evidence and all non-scope fields are preserved',()=>{
 const f=fixture(),device={id:990670,device_name:'Synthetic historical detector',device_type:'detector',unit_key:'RII-990025',organization:'Field',activation_state:'active',source:'reconeyez',source_status:'offline',source_last_seen_at:'2001-01-11T11:00:00Z',last_online_at:'2001-01-11T10:00:00Z'};
 f.summary=cameraSummary([device],[],now,f.tracker,[]);const actual=f.summary.rows.find(r=>r.id===990670),out=run(f);assert.strictEqual(out.rows.find(r=>r.id===990670),actual);assert.deepEqual(out.rows.find(r=>r.id===990670).evidence,actual.evidence);assert.equal(actual.evidence.status,'offline');assert.equal(actual.status,'review');assert.equal(out.totalDevices,2);assert.equal(out.inventory.allRecords,2);assert.equal(out.inventory.activeFieldRecords,1);
});
test('an unrelated source change does not make a stable candidate non-current',()=>{const f=fixture();f.after.audits.push({id:30,unit_key:'Ranger 990999',action:'MOVE_TO_FIELD',device_ids:[]});assert.equal(run(f).rows[0].scope,'shop');});
test('missing or malformed optional evidence returns baseline without throwing',()=>{const f=fixture();for(const v of [null,{},[],{...f.after,inventory:null}])assert.strictEqual(projectTrackerShopScope(f.summary,f.tracker,f.before,v),f.summary);});
test('SHOP display precedence keeps reachable tracker service evidence without operational green',()=>{const f=fixture();f.summary.rows[0].serviceEvidence={kind:'service_port',source:'Witness',resource:'service',active:true,status:'online',observedAt:new Date(now).toISOString(),reachable:true};const saved=f.summary.rows[0].serviceEvidence,out=run(f);assert.strictEqual(out.rows[0].serviceEvidence,saved);assert.equal(classifyCameraUnit(out.rows,now).state,'shop');assert.equal(out.online,0);assert.equal(out.offline,0);assert.equal(out.inventory.trackerOnlyRecords,f.summary.inventory.trackerOnlyRecords);assert.equal(out.inventory.sourceDeviceRecords,f.summary.inventory.sourceDeviceRecords);});
test('next request never reuses a formerly valid SHOP allowance',()=>{const f=fixture();assert.equal(run(f).rows[0].scope,'shop');f.after.sources=[];assert.equal(run(f).rows[0].scope,'unknown');});
test('bounded reader uses two fresh source reads and returns the proven classification',async()=>{const f=fixture(),calls=[];const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{readSources:async(_rows,signal)=>{calls.push('sources');assert.equal(signal.aborted,false);return f.before.sources;},readCurrent:async()=>{calls.push('current');return f.after;}});assert.deepEqual(calls,['sources','current','sources']);assert.equal(out.rows[0].scope,'shop');});
test('any optional reader rejection returns baseline',async()=>{for(const stage of ['first','current','last']){const f=fixture();let n=0;const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{readSources:async()=>{if(++n===(stage==='first'?1:stage==='last'?2:0))throw Error('Unavailable');return f.before.sources;},readCurrent:async()=>{if(stage==='current')throw Error('Unavailable');return f.after;}});assert.strictEqual(out,f.summary);}});
test('timeout aborts a pending optional read and does not apply a late allowance',async()=>{const f=fixture();let signal,finish;const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{readSources:async(_rows,s)=>{signal=s;return new Promise(resolve=>{finish=()=>resolve(f.before.sources);});},readCurrent:async()=>f.after},5);assert.strictEqual(out,f.summary);assert.equal(signal.aborted,true);finish();await new Promise(r=>setTimeout(r,0));assert.equal(f.summary.rows[0].scope,'unknown');});
test('no placeholders performs zero optional source reads',async()=>{const f=fixture();f.summary.rows=[];let reads=0;const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{readSources:async()=>{reads++;return [];},readCurrent:async()=>{reads++;return f.after;}});assert.strictEqual(out,f.summary);assert.equal(reads,0);});
test('expired projection deadline never applies a partial SHOP allowance',()=>{const f=fixture();assert.strictEqual(projectTrackerShopScope(f.summary,f.tracker,f.before,f.after,Date.now()-1),f.summary);});
test('oversized optional evidence stays review before quadratic work',()=>{const f=fixture();f.after.audits=Array.from({length:5001},(_,i)=>({id:i+1,unit_key:'Unrelated '+i,device_ids:[]}));assert.strictEqual(run(f),f.summary);});
test('large candidate work budget stays review before scanning evidence for each row',()=>{const f=fixture();f.summary.rows=Array.from({length:2000},(_,i)=>({...f.summary.rows[0],id:'tracker:helios|'+i}));f.summary.totalDevices=2000;Object.assign(f.summary.inventory,{allRecords:2000,unknownScopeRecords:2000});assert.strictEqual(run(f),f.summary);});
test('deadline crossing during the final candidate never returns a late SHOP allowance',()=>{const f=fixture(),original=Date.now;let n=0;Date.now=()=>++n<3?1:10;try{assert.strictEqual(projectTrackerShopScope(f.summary,f.tracker,f.before,f.after,5),f.summary);}finally{Date.now=original;}});

const atFixtureTime=fn=>{const saved=Date.now;Date.now=()=>now;try{return fn();}finally{Date.now=saved;}};
const withReceipt=(kind='equipment_unit')=>{const f=fixture('Helios 990001','Helios','990001',kind);f.before.mhelpReceipt=mhelpReceiptFor(f);f.after=clone(f.before);return f;};
for(const kind of ['equipment_unit','tracker'])test('current unchanged mHelp SHOP agreement retains the original guarded '+kind+' allowance',()=>atFixtureTime(()=>{const f=withReceipt(kind);assert.equal(run(f).rows[0].scope,'shop');}));
const receiptDenials={
 'newer FIELD assignment':f=>f.after.mhelpReceipt.items[0].placement='FIELD',
 'held assignment':f=>f.after.mhelpReceipt.items[0].state='held',
 'stale observation':f=>f.after.mhelpReceipt.items[0].observedAt=new Date(now-40*60000-1).toISOString(),
 'future observation':f=>f.after.mhelpReceipt.items[0].observedAt=new Date(now+1).toISOString(),
 'invalid observation date':f=>f.after.mhelpReceipt.items[0].observedAt='2001-02-30T12:00:00Z',
 'missing observation':f=>delete f.after.mhelpReceipt.items[0].observedAt,
 'stale success':f=>f.after.mhelpReceipt.lastSuccessAt=new Date(now-40*60000-1).toISOString(),
 'future success':f=>f.after.mhelpReceipt.lastSuccessAt=new Date(now+1).toISOString(),
 'success before observation':f=>f.after.mhelpReceipt.lastSuccessAt=new Date(now-1).toISOString(),
 'changed observation proof':f=>f.after.mhelpReceipt.items[0].observedAt=new Date(now-1).toISOString(),
 'changed success proof':f=>f.before.mhelpReceipt.lastSuccessAt=new Date(now-1).toISOString(),
 'non-current identity guard':f=>f.after.mhelpReceipt.items[0].guardCurrent=false,
 'missing identity guard':f=>delete f.after.mhelpReceipt.items[0].guardCurrent,
 'changed tracker UUID':f=>f.after.mhelpReceipt.items[0].trackerId='77777777-7777-4777-8777-777777777777',
 'changed native UUID':f=>f.after.mhelpReceipt.items[0].nativeUnitId='77777777-7777-4777-8777-777777777777',
 'changed tracker label':f=>f.after.mhelpReceipt.items[0].trackerLabel='Helios 990001HDC2',
 'changed native label':f=>f.after.mhelpReceipt.items[0].nativeLabel='Helios 990002',
 'missing covered identity':f=>f.after.mhelpReceipt.items=[],
 'new covered identity':f=>f.before.mhelpReceipt.items=[],
 'receipt disappears':f=>f.after.mhelpReceipt=null,
 'receipt becomes disabled':f=>f.after.mhelpReceipt.enabled=false,
 'duplicate tracker identity':f=>f.after.mhelpReceipt.items.push(clone(f.after.mhelpReceipt.items[0])),
 'duplicate native identity':f=>f.after.mhelpReceipt.items.push({...f.after.mhelpReceipt.items[0],trackerId:'77777777-7777-4777-8777-777777777777'}),
 'variant sibling ambiguity':f=>f.after.mhelpReceipt.items.push({...f.after.mhelpReceipt.items[0],trackerId:'77777777-7777-4777-8777-777777777777',nativeUnitId:null,nativeLabel:null,trackerLabel:'Helios 990001HDC2'}),
 'malformed receipt':f=>f.after.mhelpReceipt={},
 'unsupported receipt contract':f=>f.after.mhelpReceipt.contract='COS_MHELP_PLACEMENT_V2',
 'malformed enabled state':f=>f.after.mhelpReceipt.enabled='true',
 'malformed receipt collection':f=>f.after.mhelpReceipt.items={},
 'invalid location-review state':f=>f.after.mhelpReceipt.items[0].locationReview='false',
 'unsupported source schema despite receipt':f=>f.after.sources[0].schemaVersion=2,
 'source precedence despite receipt':f=>f.after.sources[0].sourcePrecedence={},
 'source-record override despite receipt':f=>f.after.sources[0].sourceRecordId='990000004',
 'missing positive SHOP source despite receipt':f=>f.after.sources=[],
};
for(const [name,mutate] of Object.entries(receiptDenials))test('mHelp '+name+' denies the optional SHOP allowance',()=>atFixtureTime(()=>{const f=withReceipt();mutate(f);assert.strictEqual(run(f),f.summary);}));
test('disabled feed retains source proof while enabled unrelated receipts cannot cover the candidate',()=>atFixtureTime(()=>{
 const disabled=withReceipt();disabled.before.mhelpReceipt.enabled=false;disabled.after=clone(disabled.before);assert.equal(run(disabled).rows[0].scope,'shop');
 const unrelated=withReceipt();for(const read of [unrelated.before,unrelated.after])read.mhelpReceipt.items=[{...read.mhelpReceipt.items[0],trackerId:'77777777-7777-4777-8777-777777777777',nativeUnitId:'88888888-8888-4888-8888-888888888888',trackerLabel:'Ranger 990999',nativeLabel:'Ranger 990999',placement:'FIELD'}];assert.strictEqual(run(unrelated),unrelated.summary);
}));
test('a current receipt-only FIELD assignment cannot be hidden by an older schema-1 SHOP import',()=>atFixtureTime(()=>{
 const f=withReceipt();f.before.mhelpReceipt.items[0].placement='FIELD';f.after=clone(f.before);
 const snapshot={items:f.before.inventory,inventoryItems:f.before.inventory,summary:{fieldUnits:1}};
 const row=f.before.mhelpReceipt.items[0];Object.assign(row,{customerLabel:'Synthetic customer',siteLabel:'Synthetic site'});f.after=clone(f.before);
 assert.equal(projectMhelpFieldPlacement(snapshot,f.before.mhelpReceipt,[],f.before.identity,now).inventoryItems[0].placement,'FIELD');
 assert.equal(projectMhelpCameraPlacement([],f.before.mhelpReceipt,[],f.before.identity,now).length,0);
 assert.strictEqual(run(f),f.summary);
}));
test('mHelp-projected actual camera scope, provider evidence and sync metadata survive optional classification',()=>atFixtureTime(()=>{
 const f=fixture(),unitId='77777777-7777-4777-8777-777777777777',trackerId='88888888-8888-4888-8888-888888888888',unit='Ranger 990200';
 f.before.inventory.push({id:unitId,unitNumber:unit,readOnly:false});f.before.nativeUnits.push({id:unitId,unit_number:unit,organization_id:ORG,status:'available'});
 f.before.devices.push({id:990700,unit_key:unit,device_name:'Synthetic provider resource',device_type:'IPC',source:'vigilant_control_center',source_status:'online',source_last_seen_at:new Date(now).toISOString(),activation_state:'active',organization:'Synthetic original field'});
 f.before.identity.unitIdentities.push({unitId,unitNumber:unit,kind:'native_provider',deviceIds:['990700'],unitKeys:[unit],proof:'d'.repeat(64)});
 const candidateReceipt=mhelpReceiptFor(f);
 f.before.mhelpReceipt={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:new Date(now).toISOString(),items:[{trackerId,nativeUnitId:unitId,trackerLabel:unit,nativeLabel:unit,state:'confirmed',placement:'SHOP',customerLabel:'Synthetic shop',siteLabel:'Synthetic shop',observedAt:new Date(now).toISOString(),locationReview:false,guardCurrent:true},...candidateReceipt.items]};f.after=clone(f.before);
 const placed=projectMhelpCameraPlacement(f.before.devices,f.before.mhelpReceipt,[],f.before.identity,now);assert.equal(placed[0].__ownerPlacement,'SHOP');
 f.summary={...cameraSummary(placed,[],now,f.tracker,[]),mhelpPlacementSync:{lastSuccessAt:f.before.mhelpReceipt.lastSuccessAt,sheetsPublisher:false}};
 const actual=f.summary.rows.find(r=>r.id===990700),out=run(f);assert.equal(out.rows.find(r=>r.trackerOnly).scope,'shop');assert.equal(actual.scope,'shop');assert.equal(actual.evidence.status,'online');assert.strictEqual(out.rows.find(r=>r.id===990700),actual);assert.strictEqual(out.mhelpPlacementSync,f.summary.mhelpPlacementSync);
}));
for(const stage of ['source-read','current-read','projection-invalid'])test('fallback diagnostic is one sanitized '+stage+' enum',async()=>{
 const f=fixture(),messages=[];const reader={onFallback:reason=>messages.push(reason),readSources:async()=>{if(stage==='source-read')throw Error('PRIVATE fixture contents must not escape');return stage==='projection-invalid'?[]:f.before.sources;},readCurrent:async()=>{if(stage==='current-read')throw Error('PRIVATE fixture contents must not escape');return f.after;}};
 assert.strictEqual(await currentTrackerShopScope(f.summary,f.tracker,f.before,reader),f.summary);assert.deepEqual(messages,[stage]);assert.equal(JSON.stringify(messages).includes('PRIVATE'),false);
});
test('timeout diagnostic wins the abort race and is emitted only once after late rejection',async()=>{
 const f=fixture(),messages=[];let reject;const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{onFallback:reason=>messages.push(reason),readSources:async()=>new Promise((_resolve,fail)=>{reject=fail;}),readCurrent:async()=>f.after},5);
 assert.strictEqual(out,f.summary);reject(Error('PRIVATE late failure'));await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(messages,['timeout']);
});
test('successful allowance has no fallback log and diagnostic exceptions cannot break baseline',async()=>{
 const f=fixture(),messages=[];assert.equal((await currentTrackerShopScope(f.summary,f.tracker,f.before,{onFallback:reason=>messages.push(reason),readSources:async()=>f.before.sources,readCurrent:async()=>f.after})).rows[0].scope,'shop');assert.deepEqual(messages,[]);
 assert.strictEqual(await currentTrackerShopScope(f.summary,f.tracker,f.before,{onFallback:()=>{throw Error('diagnostic failure');},readSources:async()=>{throw Error('source failure');},readCurrent:async()=>f.after}),f.summary);
});
test('enabled feed with candidate missing in both snapshots cannot revive the older SHOP import',()=>atFixtureTime(()=>{const f=withReceipt();f.before.mhelpReceipt.items=[];f.after=clone(f.before);assert.strictEqual(run(f),f.summary);}));
for(const [before,after] of [[false,true],[true,false]])test('feed mode transition '+before+' to '+after+' denies allowance',()=>atFixtureTime(()=>{const f=withReceipt();f.before.mhelpReceipt.enabled=before;f.after.mhelpReceipt.enabled=after;assert.strictEqual(run(f),f.summary);}));
test('malformed enabled-receipt sentinel remains review in both reads',()=>{const f=fixture();f.before.mhelpReceipt={};f.after=clone(f.before);assert.strictEqual(run(f),f.summary);});
test('default deadline admits measured 2.5s source + 2.5s current + 2.5s source reads without weakening proof',async()=>{
 const f=fixture(),messages=[],calls=[];const wait=()=>new Promise(resolve=>setTimeout(resolve,2500)),start=performance.now();
 const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{onFallback:reason=>messages.push(reason),readSources:async(_inventory,signal)=>{calls.push('source');assert.equal(signal.aborted,false);await wait();return f.before.sources;},readCurrent:async signal=>{calls.push('current');assert.equal(signal.aborted,false);await wait();return f.after;}});
 assert.equal(out.rows[0].scope,'shop');assert.deepEqual(calls,['source','current','source']);assert.deepEqual(messages,[]);assert(performance.now()-start>=7500);
});
test('explicit short deadline still aborts a slower stage and never returns a late SHOP allowance',async()=>{
 const f=fixture(),messages=[];let signal;const out=await currentTrackerShopScope(f.summary,f.tracker,f.before,{onFallback:reason=>messages.push(reason),readSources:async(_inventory,s)=>{signal=s;await new Promise(resolve=>setTimeout(resolve,75));return f.before.sources;},readCurrent:async()=>f.after},25);
 assert.strictEqual(out,f.summary);assert.equal(signal.aborted,true);assert.deepEqual(messages,['timeout']);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.summary.rows[0].scope,'unknown');assert.deepEqual(messages,['timeout']);
});
