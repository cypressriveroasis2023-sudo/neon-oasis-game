import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {projectOwnerPlacement as baseline} from './fixtures/native-alias-cpu-baseline.ts';
import {projectOwnerPlacement as candidate} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {aliasPopulation,markedAudit,uuid,run} from './fixtures/native-alias-cpu-population.mjs';
const outcome=async(fn,f)=>{try{return {value:await run(fn,f)};}catch(e){return {error:{name:e.name,message:e.message,status:e.status}};}};
async function parity(f){const before=structuredClone(f),expected=await outcome(baseline,f);assert.deepEqual(await outcome(candidate,f),expected);assert.deepEqual(f,before);return expected;}
test('complete projection parity at empty, representative and 1001-unit populations',async()=>{for(const count of [0,1,203,434,1001]){const f=aliasPopulation(count),out=await parity(f);assert.equal(out.value.nativePlacementAliases.length,count);}});
test('indexed candidates retain every duplicate, exact suffix, warning and conflicting audit',async()=>{
 const cases=[
 f=>f.identity.unitIdentities.push(f.identity.unitIdentities[0]),
 f=>f.identity.unitIdentities[0].deviceIds.push('1'),
 f=>f.identity.unitIdentities[0].unitKeys.push('SPOTTER 1'),
 f=>f.identity.unitIdentities[1].deviceIds.push('1'),
 f=>f.identity.unitIdentities[1].unitKeys.push(' SPOTTER 1 '),
 f=>f.identity.unitIdentities[0].unitKeys=[' SPOTTER 1'],
 f=>f.identity.unitIdentities[0].unitKeys=['SPOTTER 1','SPOTTER 2'],
 f=>f.devices.push({...f.devices[0]}),
 f=>f.devices.push({id:'999',unit_key:'spotter1HDC2'}),
 f=>f.devices.push({id:'999',unit_key:'SPOTTER 01'}),
 f=>f.devices[0].unit_key='SPOTTER 1.0',
 f=>f.devices[0].unit_key={untrusted:true},
 f=>f.devices[0].id=null,
 f=>{f.snapshot.inventoryItems[1].unitNumber='SPOTTER 1';f.units[1].unit_number='SPOTTER 1';},
 f=>f.identity.identityWarnings.push({unitId:uuid(999),reason:'Synthetic hold',unitKeys:['spotter 1'],deviceIds:[]}),
 f=>f.identity.identityWarnings.push({unitId:uuid(999),reason:'Synthetic hold',unitKeys:[],deviceIds:['1']}),
 f=>f.identity.identityWarnings.push({unitId:f.units[0].id,reason:'Synthetic hold',unitKeys:[],deviceIds:[]}),
 f=>f.audits.push(markedAudit()),
 f=>f.audits.push(markedAudit(0,{placement:'SHOP',action:'MOVE_TO_ROOT',site_label:null,street_address:null})),
 f=>f.audits.push(markedAudit(),markedAudit(0,{id:'100',contract:null})),
 f=>f.audits.push(markedAudit(1,{device_ids:['1']})),
 f=>f.audits.push(markedAudit(1,{unit_key:'SPOTTER 1HDC2'})),
 f=>f.audits.push(markedAudit(),markedAudit(1,{control_id:markedAudit().control_id})),
 f=>f.audits.push(markedAudit(0,{id:'9999999999999999999999'}),markedAudit(0,{id:'2'})),
 f=>f.audits.push(markedAudit(0,{contract:null,device_ids:[null,'bad',1,'1']})),
 f=>f.audits.push(markedAudit(),markedAudit()),
 f=>{f.identity.ownerConfirmedIdentityVersion=1;f.identity.ownerConfirmedUnitIdentities=[{...f.identity.unitIdentities.shift(),kind:'owner_confirmed_native'}];},
 f=>{f.identity.ownerConfirmedIdentityVersion=1;f.identity.ownerConfirmedUnitIdentities=[{...f.identity.unitIdentities[0],kind:'owner_confirmed_native'}];},
 f=>{f.identity.unitIdentities=[];f.devices=[null];},
 f=>{f.identity.unitIdentities=[];f.devices=[null];f.audits=[markedAudit()];},
 f=>{f.identity.unitIdentities=[null];},
 f=>{f.identity.identityWarnings=[null];},
 f=>{f.units=[];},
 f=>{f.snapshot.inventoryItems.push(f.snapshot.inventoryItems[0]);},
 ];
 for(const change of cases){const f=aliasPopulation(3);change(f);await parity(f);}
});
test('normalization candidates are linear in roster size and never reused after mutations or other invocations',async()=>{
 const f=aliasPopulation(434);let reads=0;for(const d of f.devices){const key=d.unit_key;Object.defineProperty(d,'unit_key',{get(){reads++;return key;},configurable:true});}
 const result=await run(candidate,f);assert.equal(result.nativePlacementAliases.length,434);assert(reads<12*f.devices.length,`unexpected repeated fleet scan: ${reads}`);
 const changed=aliasPopulation(12);await parity(changed);changed.identity.identityWarnings.push({unitId:changed.units[0].id,reason:'New hold',unitKeys:[],deviceIds:[]});await parity(changed);
 changed.devices[0].unit_key='SPOTTER 99';await parity(changed);changed.audits.push(markedAudit(1,{device_ids:['1']}));await parity(changed);
 const independent=aliasPopulation(12);assert.equal((await run(candidate,independent)).nativePlacementAliases.length,12);
});
test('only the native alias helper differs from the pinned main source; other guards and routes are unchanged',()=>{
 const base=fs.readFileSync(new URL('./fixtures/native-alias-cpu-baseline.ts',import.meta.url),'utf8'),next=fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/placementProjection.ts',import.meta.url),'utf8');
 const outside=s=>{const a=s.indexOf('function nativePlacementAliases('),b=s.indexOf('\n/** Healthy unmarked',a);return [s.slice(0,a),s.slice(b).trimEnd()];};assert.deepEqual(outside(next),outside(base));
 assert.equal(createHash('sha256').update(base).digest('hex'),'8c0b3e42b48eefe9c246f1bc8f6df3de068caae7b23317de070092e359310133');
});

test('seeded combinations and permutations retain full projection/error parity',async()=>{
 let seed=127;const rand=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
 for(let i=0;i<100;i++){const f=aliasPopulation(5);for(let k=0;k<4;k++){const n=rand(5);switch(rand(8)){
 case 0:f.audits.push(markedAudit(n,{id:String(100+i*10+k),device_ids:rand(2)?[String(rand(20)+1)]:f.identity.unitIdentities[n].deviceIds}));break;
 case 1:f.devices[rand(20)].unit_key=['SPOTTER 1','spotter 01','SPOTTER 1.0','Spotter1HDC2','UNKNOWN'][rand(5)];break;
 case 2:f.identity.unitIdentities.push({...f.identity.unitIdentities[n]});break;
 case 3:f.identity.identityWarnings.push({unitId:uuid(900+n),reason:'Synthetic hold',deviceIds:[String(rand(20)+1)],unitKeys:rand(2)?['SPOTTER '+(n+1)]:[]});break;
 case 4:f.identity.unitIdentities[n].unitKeys=[' SPOTTER '+(n+1)];break;
 case 5:f.identity.unitIdentities[n].deviceIds=[String(rand(20)+1)];break;
 case 6:f.devices[rand(20)].id='invalid';break;
 case 7:f.audits.push(markedAudit(n,{id:String(100+i*10+k),contract:null,device_ids:[null,'bad',String(rand(20)+1)]}));break;
 }}if(rand(2)){f.devices.reverse();f.identity.unitIdentities.reverse();f.audits.reverse();}await parity(f);}
});
