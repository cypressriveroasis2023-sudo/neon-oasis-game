import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {issueHandoffLocationProof} from '../../supabase/functions/cos-operations-pages/handoffLocationProof.ts';
import {actor,native,tracker,request,now,at,secret,context,body,locationRead,ownerRoot} from './fixtures/handoff-proof-fixtures.mjs';
const issue=(read=()=>locationRead(),who=context,requestBody=body,key=secret,revalidate=async()=>who,options={})=>issueHandoffLocationProof(who,requestBody,async()=>read(),()=>key,revalidate,{now:()=>now,...options});
test('unlinked legacy IT gets a scoped proof after two reads and three current capability checks',async()=>{
 let reads=0,auth=0;const result=await issue(()=>{reads++;return locationRead();},context,body,secret,async()=>{auth++;return context;});
 assert.equal(reads,2);assert.equal(auth,3);assert.equal(createHmac('sha256',Buffer.from(secret,'hex')).update(result.payload).digest('hex'),result.signature);
 const p=JSON.parse(result.payload);assert.equal(p.actor_id,actor);assert.equal(p.request_id,request);assert.equal(p.expires_at-p.issued_at,30);assert.equal(Date.parse(p.items[0].legacy_updated_at),Date.parse(at));
 assert.match(p.items[0].authority_sha256,/^[a-f0-9]{64}$/);assert.equal(p.items[0].authority,undefined);
});
test('Service, invalid action/scope, duplicate identity and missing key issue no proof',async()=>{
 await assert.rejects(issue(undefined,{...context,department:'service'}),/verified IT or Owner/);
 await assert.rejects(issue(undefined,context,{...body,purpose:'inventory_release'}),/verified IT or Owner/);
 for(const requestBody of [{...body,actor_id:native},{...body,organization_id:native},{...body,purpose:'arbitrary'}])await assert.rejects(issue(undefined,context,requestBody));
 for(const items of [[],Array(21).fill(body.items[0]),[body.items[0],body.items[0]],[{...body.items[0],unit_tag:' 001'}],[{...body.items[0],family:1}],[{...body.items[0],native_id:native}]])await assert.rejects(issue(undefined,context,{...body,items}),/Exact equipment/);
 let reads=0;await assert.rejects(issue(()=>{reads++;return locationRead();},context,body,''),/held for installation/);assert.equal(reads,0);
 const who={...context,legacyOwner:true,department:'owner'},requestBody={...body,purpose:'inventory_release'};
 assert.equal(JSON.parse((await issue(()=>locationRead({requestBody}),who,requestBody)).payload).purpose,'inventory_release');
});
for(const [name,change] of Object.entries({
 'wrong contract':r=>r.attestation.contract='legacy',
 'wrong organization':r=>r.attestation.organization_id=native,
 'foreign actor':r=>r.attestation.legacy_actor_id=native,
 'wrong request':r=>r.attestation.request_id=native,
 'wrong purpose':r=>r.attestation.purpose='inventory_release',
 'unexpected disclosure':r=>r.attestation.customer='private',
 'missing requested unit':r=>r.attestation.items=[],
 'extra unrequested unit':r=>r.attestation.items.push({...r.attestation.items[0]}),
 'changed family':r=>r.attestation.items[0].family='Ranger',
 'native identity mismatch':r=>r.attestation.items[0].native_unit_id=tracker,
 'invalid tracker':r=>r.attestation.items[0].tracker_id='bad',
 'Field placement':r=>r.attestation.items[0].placement='FIELD',
 'unbound authority':r=>r.attestation.items[0].authority_sha256='',
 'stale observation':r=>r.attestation.items[0].observed_at='2026-10-17T06:00:00Z',
 'future observation':r=>r.attestation.items[0].observed_at='2026-10-17T09:00:00Z',
 'source success before observation':r=>r.attestation.items[0].source_success_at='2026-10-17T07:58:00Z',
 'stale attestation':r=>r.attestation.checked_at='2026-10-17T07:59:00Z',
 'expired attestation':r=>r.attestation.valid_until='2026-10-17T07:59:00Z',
 'overlong validity':r=>r.attestation.valid_until='2026-10-17T08:01:00Z',
 'changed legacy family':r=>r.equipment[0].canonical_family='Ranger',
 'duplicate legacy identity':r=>r.equipment.push({...r.equipment[0],equipment_key:'duplicate-key'}),
 'legacy Field state':r=>r.equipment[0].tracker_state='field_or_unknown',
 'ambiguous camera label':r=>r.devices=[{id:1,unit_key:'Sniper 1'}],
 'Owner Field':r=>{ownerRoot(r);r.audits[0]={...r.audits[0],placement:'FIELD',action:'MOVE_TO_FIELD',site_label:'Synthetic site',street_address:'Synthetic address'};},
 'changed Owner camera identity':r=>{ownerRoot(r);r.devices=[];},
 'later unmarked camera edit':r=>{ownerRoot(r);r.audits.unshift({...r.audits[0],id:'2',contract:null});}
}))test(name+' denies issuance',async()=>{await assert.rejects(issue(()=>{const r=locationRead();change(r);return r;}));});
test('current reviewed ROOT can corroborate Shop, while its private detail remains out of proof',async()=>{
 const result=await issue(()=>ownerRoot());assert.equal(JSON.parse(result.payload).items[0].equipment_key,'sniper:001');assert.doesNotMatch(result.payload,/device_ids|control_id|MOVE_TO_ROOT/);
});
for(const step of [1,2,3])for(const [name,change] of Object.entries({capability:c=>c.fleetRead=false,actor:c=>c.legacyId=native,role:c=>c.department='service'}))test(name+' revocation at authorization step '+step+' denies issuance',async()=>{
 let auth=0;await assert.rejects(issue(undefined,context,body,secret,async()=>{const c={...context};if(++auth===step)change(c);return c;}),/access changed/);
});
for(const [name,change] of Object.entries({
 'native authority':r=>r.attestation.items[0].authority_sha256='b'.repeat(64),
 'legacy revision':r=>r.equipment[0].updated_at='2026-10-17T07:59:30Z',
 'Owner evidence':r=>ownerRoot(r)
}))test(name+' change between observations rejects the earlier proof',async()=>{
 let n=0;await assert.rejects(issue(()=>{const r=locationRead();if(++n===2)change(r);return r;}),/Current Shop/);
});
test('proof expiration is capped by the earlier native attestation and freshness boundary',async()=>{
 let n=0;const r=await issue(()=>{const x=locationRead();x.attestation.valid_until=new Date(now+(++n===1?5000:20000)).toISOString();return x;});
 assert.equal(JSON.parse(r.payload).expires_at,now/1000+5);
});
test('deadline and caller abort stop issuance even when an upstream ignores cancellation',async()=>{
 await assert.rejects(issue(()=>new Promise(()=>{}),context,body,secret,async()=>context,{deadlineMs:now+20}),/deadline/);
 const c=new AbortController();c.abort();await assert.rejects(issue(undefined,context,body,secret,async()=>context,{signal:c.signal}),/deadline/);
 let clock=now;await assert.rejects(issue(undefined,context,body,secret,async()=>{clock+=4000;return context;},{now:()=>clock}),/deadline/);
});
test('a post-read native change is outside this read-only protocol; no distributed-lock claim',async()=>{
 let laterPlacement='SHOP',auth=0;const result=await issue(undefined,context,body,secret,async()=>{if(++auth===3)laterPlacement='FIELD';return context;});
 assert.equal(laterPlacement,'FIELD');assert.ok(result.signature);assert.ok(JSON.parse(result.payload).expires_at<=now/1000+30);
});
