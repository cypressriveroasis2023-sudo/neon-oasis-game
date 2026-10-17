import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {issueHandoffLocationProof} from '../../supabase/functions/cos-operations-pages/handoffLocationProof.ts';
const actor='00000000-0000-4000-8000-000000000001',native='00000000-0000-4000-8000-000000000011',tracker='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013',now=Date.parse('2026-10-17T08:00:00Z'),at='2026-10-17T07:59:00Z',secret='12'.repeat(32);
const context={legacyId:actor,actorId:native,department:'it',legacyOwner:false};
const body={request_id:request,purpose:'checkout',items:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001'}]};
export function locationRead(){return {equipment:[{equipment_key:'sniper:001',canonical_family:'Sniper',unit_tag:'001',tracker_state:'shop',updated_at:at}],map:{effectivePlacementVersion:1,items:[],inventoryItems:[{id:native,unitNumber:'Sniper 001',readOnly:false,placement:'SHOP',effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'shop',source:'mhelpdesk',observedAt:at,reason:null},activeInventoryEligible:true}]},mhelp:{contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:at,items:[{trackerId:tracker,nativeUnitId:native,trackerLabel:'Sniper 001',nativeLabel:'Sniper 001',state:'confirmed',guardCurrent:true,placement:'SHOP',customerLabel:'Shop',siteLabel:'Shop',observedAt:at,locationReview:false,assignmentChanged:false}]}};}
const issue=(read=()=>locationRead(),who=context,requestBody=body,key=secret)=>issueHandoffLocationProof(who,requestBody,async()=>read(),()=>key,()=>now);
test('server proof uses two complete current reads, exact identity and a 30-second actor/request HMAC binding',async()=>{
 let reads=0;const result=await issue(()=>{reads++;return locationRead();});assert.equal(reads,2);assert.equal(createHmac('sha256',Buffer.from(secret,'hex')).update(result.payload).digest('hex'),result.signature);
 const p=JSON.parse(result.payload);assert.equal(p.actor_id,actor);assert.equal(p.request_id,request);assert.equal(p.expires_at-p.issued_at,30);assert.equal(p.items[0].equipment_key,'sniper:001');assert.equal(p.items[0].legacy_updated_at,at);assert.match(p.items[0].authority_sha256,/^[a-f0-9]{64}$/);
});
test('unlinked, Service, invalid scope, duplicate identity and missing key cannot issue proof',async()=>{
 for(const who of [{...context,actorId:null},{...context,department:'service'}])await assert.rejects(issue(undefined,who),/verified IT or Owner/);
 await assert.rejects(issue(undefined,context,{...body,purpose:'inventory_release'}),/verified IT or Owner/);
 await assert.rejects(issue(undefined,context,{...body,organization_id:'foreign'}),/verified IT or Owner/);
 await assert.rejects(issue(undefined,context,{...body,items:[body.items[0],body.items[0]]}),/Exact equipment/);
 await assert.rejects(issue(undefined,context,body,''),/held for installation/);
 assert.equal(JSON.parse((await issue(undefined,{...context,legacyOwner:true,department:'owner'},{...body,purpose:'inventory_release'})).payload).purpose,'inventory_release');
});
for(const [name,change] of Object.entries({
 'newer field placement':r=>r.map.inventoryItems[0].placement='FIELD',
 'field membership contradiction':r=>r.map.items.push(r.map.inventoryItems[0]),
 'identity review':r=>r.map.inventoryItems[0].placementStatus='needs_identity_review',
 'retired or inactive unit':r=>r.map.inventoryItems[0].activeInventoryEligible=false,
 'installed native site':r=>r.map.inventoryItems[0].installedSiteId=native,
 'native GPS evidence':r=>r.map.inventoryItems[0].hasUnitGps=true,
 'unqualified native label':r=>r.map.inventoryItems[0].unitNumber='001',
 'duplicate qualified label':r=>r.map.inventoryItems.push({...r.map.inventoryItems[0],id:tracker}),
 'held MHelp guard':r=>r.mhelp.items[0].guardCurrent=false,
 'field MHelp observation':r=>r.mhelp.items[0].placement='FIELD',
 'MHelp assignment change':r=>r.mhelp.items[0].assignmentChanged=true,
 'MHelp location review':r=>r.mhelp.items[0].locationReview=true,
 'stale MHelp observation':r=>r.mhelp.items[0].observedAt='2026-10-17T06:00:00Z',
 'future MHelp observation':r=>r.mhelp.items[0].observedAt='2026-10-17T09:00:00Z',
 'missing MHelp coverage':r=>r.mhelp.items=[],
 'disabled MHelp feed':r=>r.mhelp.enabled=false,
 'source refresh failure':r=>r.mhelp.errorCode='unavailable',
 'changed native binding':r=>r.mhelp.items[0].nativeUnitId=tracker,
 'changed legacy family':r=>r.equipment[0].canonical_family='Ranger',
 'duplicate legacy identity':r=>r.equipment.push({...r.equipment[0],equipment_key:'duplicate-key'}),
 'legacy field placement':r=>r.equipment[0].tracker_state='field_or_unknown'
}))test(name+' denies checkout proof',async()=>{await assert.rejects(issue(()=>{const r=locationRead();change(r);return r;}));});
test('changed source between the two observations cannot reuse older Shop proof',async()=>{let reads=0;await assert.rejects(issue(()=>{const r=locationRead();if(++reads===2)r.equipment[0].updated_at='2026-10-17T07:59:30Z';return r;}),/Current Shop/);});
