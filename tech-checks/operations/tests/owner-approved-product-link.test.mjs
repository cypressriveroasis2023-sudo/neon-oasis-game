// Owner decision 2026-11-11 (James Martin): a fresh, recorded Owner approval
// ties one exact mHelp Product ID (A#) to one existing COS record. Inventory
// identity only. It must survive later mHelp loads, never loosen any other
// unit's checks, and stop applying the moment anything it rests on changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMhelpUploadPlacement,approvedLinkLabel} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
const now=Date.parse('2026-11-11T21:00:00Z');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),sha=c=>c.repeat(64);
const unit=(n,unitNumber,patch={})=>({id:id(n),unitNumber,status:'available',readOnly:false,currentLocationType:null,latitude:null,longitude:null,...patch});
const units=()=>[unit(1,'Solar Spotter 012HDC2'),unit(2,'Spotter 028.1HDC4S'),unit(3,'Solar Spotter 028HDC2'),unit(4,'Solar Spotter 011HDC2'),unit(5,'Spotter 023HDC4S')];
const map=rows=>({inventoryItems:rows,items:[],generatedAt:new Date(now).toISOString(),summary:{}});
const rec=(productId,unitNumber,patch={})=>({productId,unitNumber,category:'Solar Spotter',customerId:'11',customer:'Synthetic customer: Site',sourceAddress:{},sourceRow:2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:null,...patch});
const bound=(productId,u)=>({productId,trackerId:null,trackerLabel:null,nativeUnitId:u.id,nativeLabel:u.unitNumber,fullLabel:'SOLAR SPOTTER 028',matchMethod:'exact_family_unit',evidenceSha256:sha('a'),expectedGuard:sha('a'),guardCurrent:true});
const records=u=>[rec('2232677','Solar Spotter 012',{holdReason:'Product ID identity label changed; confirm before linking',possibleAliasUnitIds:[]}),rec('2221820','Spotter 028.1 HDC4S - SOLAR COMPATIBLE',{category:'Spotter HDC4',holdReason:'Prior reviewed scoped identity or assignment requires Owner installation review',possibleAliasUnitIds:[]}),
 rec('2274383','SOLAR SPOTTER 028',{binding:bound('2274383',u[2])}),rec('2232676','Solar Spotter 011',{possibleAliasUnitIds:[u[3].id,id(40)],holdReason:'identity_conflict'}),
 rec('2264694','Spotter 023  -  HDC4S - SOLAR COMPATIBLE',{possibleAliasUnitIds:[u[4].id,id(50)]}),rec('2258987','Solar Spotter 018',{holdReason:'api_equipment_label_changed'}),rec('2301876','RANGER 029 .2',{holdReason:'Native identity or location evidence changed; fresh association review required'})];
const upload=(recs,at=now-60000)=>({contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,reviewed:true,sourceSha256:sha('c'),payloadSha256:sha('d'),receivedAt:new Date(at).toISOString(),receivedAtPrecision:'second',exportAsOf:null,recordCount:recs.length,apiMissingRecords:[],records:recs});
const links=()=>[{approvalId:id(901),productId:'2232677',unitId:id(1),mhelpLabel:'Solar Spotter 012',cosLabel:'Solar Spotter 012HDC2'},{approvalId:id(902),productId:'2221820',unitId:id(2),mhelpLabel:'Spotter 028.1 HDC4S - SOLAR COMPATIBLE',cosLabel:'Spotter 028.1HDC4S'}];
const run=(recs,approved,u=units(),at)=>projectMhelpUploadPlacement(map(u),upload(recs,at),[],undefined,now,approved===undefined?{}:{ownerApprovedLinks:approved});
const by=result=>Object.fromEntries(result.snapshot.uploadInventory.records.map(r=>[r.productId,r]));

test('the two approved A#s link to exactly the approved COS records; mHelp placement and customer are applied to them',()=>{
 const u=units(),result=run(records(u),links(),u),r=by(result);
 for(const [pid,n,label] of [['2232677',1,'Solar Spotter 012HDC2'],['2221820',2,'Spotter 028.1HDC4S']]){
  assert.deepEqual(r[pid].binding,{state:'linked',unitIds:[id(n)],candidateUnitIds:[],placementHeld:false,matchMethod:'owner_approved_product_id',reason:null,approvalId:id(900+n)});
  const row=result.snapshot.inventoryItems.find(x=>x.id===id(n));
  assert.equal(row.unitNumber,label);assert.equal(row.uploadProductId,pid);assert.equal(row.placement,'FIELD');assert.equal(row.customer,'Synthetic customer: Site');
 }
});
test('every other unit is byte-for-byte what it was without any approved link, holds included',()=>{
 const u=units(),before=run(records(u),undefined,u),after=run(records(u),links(),u),b=by(before),a=by(after);
 for(const pid of ['2274383','2232676','2264694','2258987','2301876'])assert.deepEqual(a[pid],b[pid],pid);
 assert.equal(a['2232676'].binding.state,'held');assert.equal(a['2232676'].binding.reason,'identity_conflict');assert.equal(a['2264694'].binding.state,'held');
 assert.equal(a['2258987'].binding.state,'unlinked');assert.equal(a['2301876'].binding.state,'unlinked');
 for(const n of [3,4,5])assert.deepEqual(after.snapshot.inventoryItems.find(x=>x.id===id(n)),before.snapshot.inventoryItems.find(x=>x.id===id(n)));
 assert.equal(b['2232677'].binding.state,'unlinked');assert.equal(b['2221820'].binding.state,'unlinked');assert.equal(b['2232677'].binding.reason,'Product ID identity label changed; confirm before linking');
 const empty=run(records(u),[],u).snapshot;assert.deepEqual(empty.ownerApprovedLinks,{contract:'COS_OWNER_PRODUCT_LINKS_STATE_V1',state:'ready',approvals:0,applied:0});
 assert.deepEqual({...empty,ownerApprovedLinks:undefined},{...before.snapshot,ownerApprovedLinks:undefined});   // an empty approval list changes nothing else
 assert.deepEqual(after.snapshot.ownerApprovedLinks,{contract:'COS_OWNER_PRODUCT_LINKS_STATE_V1',state:'ready',approvals:2,applied:2});assert.equal('ownerApprovedLinks' in before.snapshot,false);
});
test('the link is kept on the next mHelp load, including a capital-letter or trailing-space-only label difference',()=>{
 const u=units(),next=records(u).map(r=>r.productId==='2232677'?{...r,unitNumber:'SOLAR SPOTTER 012 ',customer:'New customer: New site',placement:'SHOP'}:r);
 const result=run(next,links(),u,now-1000),r=by(result);
 assert.equal(r['2232677'].binding.state,'linked');assert.deepEqual(r['2232677'].binding.unitIds,[id(1)]);assert.equal(r['2221820'].binding.state,'linked');
 const row=result.snapshot.inventoryItems.find(x=>x.id===id(1));assert.equal(row.placement,'SHOP');assert.equal(row.customer,'New customer: New site');   // mHelp stays the placement authority
 assert.equal(approvedLinkLabel('SOLAR SPOTTER 012 '),approvedLinkLabel('Solar Spotter 012'));assert.notEqual(approvedLinkLabel(' Solar Spotter 012'),approvedLinkLabel('Solar Spotter 012'));
});
test('any real label change in mHelp stops the link from applying; nothing is guessed',()=>{
 const u=units();
 for(const label of ['Solar Spotter 012.1','Solar  Spotter 012','Solar Spotter 12',' Solar Spotter 012','Solar Spotter 012 HDC2']){
  const r=by(run(records(u).map(x=>x.productId==='2232677'?{...x,unitNumber:label}:x),links(),u));
  assert.equal(r['2232677'].binding.state,'unlinked',label);assert.equal(r['2232677'].binding.reason,'approved_link_label_changed');assert.deepEqual(r['2232677'].binding.unitIds,[]);
  assert.equal(r['2221820'].binding.state,'linked');                      // the other approval is independent
 }
});
test('a renamed, missing, retired or inactive COS record stops the link from applying',()=>{
 for(const [patch,reason] of [[{unitNumber:'Solar Spotter 012HDC4'},'approved_link_record_unavailable_or_renamed'],[null,'approved_link_record_unavailable_or_renamed'],[{status:'retired'},'approved_link_record_inactive'],[{activeInventoryEligible:false},'approved_link_record_inactive'],[{retiredAt:'2026-11-01T00:00:00Z'},'approved_link_record_inactive']]){
  const u=units().flatMap((x,i)=>i===0?(patch?[{...x,...patch}]:[]):[x]),result=run(records(units()),links(),u),r=by(result);
  assert.equal(r['2232677'].binding.state,'unlinked',reason);assert.equal(r['2232677'].binding.reason,reason);
  const row=result.snapshot.inventoryItems.find(x=>x.id===id(1));if(row)assert.equal(row.uploadProductId,undefined);
 }
});
test('a Do Not Use or Missing A#, or an A# under any existing hold, is never linked by an approval',()=>{
 const u=units();
 for(const lifecycle of ['DO_NOT_USE','MISSING']){const r=by(run(records(u).map(x=>x.productId==='2232677'?{...x,lifecycle}:x),links(),u));assert.equal(r['2232677'].binding.state,'unlinked');assert.equal(r['2232677'].binding.reason,'approved_link_source_flagged');}
 for(const hold of [{possibleAliasUnitIds:[id(1),id(77)]},{placementHeld:true},{holdReason:'identity_conflict'},{holdReason:'api_equipment_label_changed'},{holdReason:'Native identity or location evidence changed; fresh association review required'},{holdReason:'anything else'},{inventoryOnlyReason:'no_sim',placement:'SHOP',placementHeld:true}]){
  const recs=records(u).map(x=>x.productId==='2232677'?{...x,...hold}:x),r=by(run(recs,links(),u)),same=by(run(recs,undefined,u));
  assert.deepEqual(r['2232677'],same['2232677']);assert.notEqual(r['2232677'].binding.state,'linked');
 }
});
test('an approval can never claim a COS record that any saved binding or possible alias already points at',()=>{
 const u=units();
 // Approving A#2232677 onto the record already bound to Solar Spotter 028, or onto a held candidate, is refused and held.
 for(const target of [u[2],u[3]]){
  const approved=[{...links()[0],unitId:target.id,cosLabel:target.unitNumber}],result=run(records(u),approved,u),r=by(result);
  assert.equal(r['2232677'].binding.state,'held');assert.equal(r['2232677'].binding.reason,'approved_link_identity_conflict');assert.deepEqual(r['2232677'].binding.unitIds,[]);
  assert.deepEqual(r['2274383'],by(run(records(u),undefined,u))['2274383']);
 }
});
test('Solar Spotter 018 and Ranger 029 .2 cannot be linked by an approval while their own review notes stand',()=>{
 const u=[...units(),unit(6,'Solar Spotter 018HDC2'),unit(7,'Ranger 029')],approved=[{approvalId:id(904),productId:'2258987',unitId:id(6),mhelpLabel:'Solar Spotter 018',cosLabel:'Solar Spotter 018HDC2'},{approvalId:id(905),productId:'2301876',unitId:id(7),mhelpLabel:'RANGER 029 .2',cosLabel:'Ranger 029'}];
 const r=by(run(records(u),approved,u)),same=by(run(records(u),undefined,u));
 for(const pid of ['2258987','2301876']){assert.deepEqual(r[pid],same[pid]);assert.equal(r[pid].binding.state,'unlinked');}
});
test('a saved binding always outranks an approval for the same A#',()=>{
 const u=units(),approved=[{approvalId:id(903),productId:'2274383',unitId:id(1),mhelpLabel:'SOLAR SPOTTER 028',cosLabel:'Solar Spotter 012HDC2'}];
 const r=by(run(records(u),approved,u));assert.deepEqual(r['2274383'].binding.unitIds,[id(3)]);assert.equal(r['2274383'].binding.matchMethod,'exact_family_unit');
});
test('malformed, duplicated or oversized approval lists are rejected outright',()=>{
 const u=units(),good=links();
 for(const bad of [{},'x',[{...good[0],extra:1}],[{...good[0],productId:'abc'}],[{...good[0],unitId:'nope'}],[{...good[0],mhelpLabel:''}],[{...good[0],cosLabel:'<b>'}],[good[0],{...good[1],productId:good[0].productId}],[good[0],{...good[1],unitId:good[0].unitId}],[{...good[0],approvalId:undefined}],Array.from({length:501},(_,i)=>({...good[0],productId:String(1000+i),unitId:id(2000+i)}))])
  assert.throws(()=>run(records(u),bad,u),/Invalid Owner-approved Product links/);
});

// The deployed function is a single bundled file. Run the same behaviour against
// the bundled copy of this module, so the code that ships is the code that was tested.
import {readFileSync} from 'node:fs';
import {completedBoard} from '../durable-board/project.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectCurrentTrackerPlacement,projectCombinedFleetRoster} from '../../supabase/functions/cos-operations-pages/combinedFleetRoster.ts';
import {readRecordedRoster} from '../src/fleetRecordedRoster.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import {snapshot} from './fixtures/camera-evidence-fixtures.mjs';
import {readOwnerApprovedProductLinks} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
const bundle=readFileSync(new URL('../../docs/vision-native-preview-20261107/source/serve.ts',import.meta.url),'utf8');
const from=bundle.indexOf('  // ../supabase/functions/cos-operations-pages/placementProjection.ts'),to=bundle.indexOf('  // ../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts');
const shipped=new Function(bundle.slice(from,to)+'\nreturn {projectMhelpUploadPlacement,readOwnerApprovedProductLinks,approvedLinkLabel};')();
test('the bundled copy that ships behaves identically to the tested module',async()=>{
 assert.ok(from>0&&to>from);
 const u=units(),cases=[[records(u),links()],[records(u),undefined],[records(u),[]],
  [records(u).map(r=>r.productId==='2232677'?{...r,unitNumber:'SOLAR SPOTTER 012 ',placement:'SHOP'}:r),links()],[records(u).map(r=>r.productId==='2232677'?{...r,unitNumber:'Solar Spotter 012.1'}:r),links()],
  [records(u).map(r=>r.productId==='2221820'?{...r,lifecycle:'DO_NOT_USE'}:r),links()],[records(u),[{...links()[0],unitId:u[2].id,cosLabel:u[2].unitNumber}]],[records(u).map(r=>r.productId==='2232677'?{...r,placementHeld:true}:r),links()]];
 for(const [recs,approved] of cases){
  const opts=approved===undefined?{}:{ownerApprovedLinks:approved};
  assert.deepEqual(JSON.parse(JSON.stringify(shipped.projectMhelpUploadPlacement(map(units()),upload(recs),[],undefined,now,opts))),JSON.parse(JSON.stringify(projectMhelpUploadPlacement(map(units()),upload(recs),[],undefined,now,opts))));
 }
 for(const u2 of [units().slice(1),units().map((x,i)=>i===0?{...x,status:'retired'}:x)])assert.deepEqual(JSON.parse(JSON.stringify(shipped.projectMhelpUploadPlacement(map(u2),upload(records(units())),[],undefined,now,{ownerApprovedLinks:links()}))),JSON.parse(JSON.stringify(projectMhelpUploadPlacement(map(u2),upload(records(units())),[],undefined,now,{ownerApprovedLinks:links()}))));
 assert.throws(()=>shipped.projectMhelpUploadPlacement(map(units()),upload(records(u)),[],undefined,now,{ownerApprovedLinks:[{...links()[0],extra:1}]}),/Invalid Owner-approved Product links/);
 assert.ok(bundle.includes('ownerApprovedLinks:await readOwnerApprovedProductLinks(rpc,ORGANIZATION_ID)'));
});
test('an unreadable or malformed approvals source is reported as unavailable, never as "no approvals"',async()=>{
 for(const read of [readOwnerApprovedProductLinks,shipped.readOwnerApprovedProductLinks]){
  const good={contract:'COS_OWNER_PRODUCT_LINKS_V1',links:links()},calls=[];
  assert.deepEqual(await read(async(name,payload)=>{calls.push([name,payload]);return good;},'org'),links());assert.deepEqual(calls,[['cos_owner_product_links_active_v1',{p_organization_id:'org'}]]);
  assert.deepEqual(await read(async()=>({contract:'COS_OWNER_PRODUCT_LINKS_V1',links:[]}),'org'),[]);
  for(const bad of [async()=>{throw Error('404');},async()=>null,async()=>({contract:'OTHER',links:links()}),async()=>({contract:'COS_OWNER_PRODUCT_LINKS_V1',links:[{...links()[0],productId:'x'}]}),async()=>({contract:'COS_OWNER_PRODUCT_LINKS_V1',links:'x'})])assert.deepEqual(await read(bad,'org'),{unavailable:true});
 }
 const u=units();
 for(const project of [projectMhelpUploadPlacement,shipped.projectMhelpUploadPlacement]){
  const out=project(map(units()),upload(records(u)),[],undefined,now,{ownerApprovedLinks:{unavailable:true}}),r=by(out);
  assert.deepEqual(JSON.parse(JSON.stringify(out.snapshot.ownerApprovedLinks)),{contract:'COS_OWNER_PRODUCT_LINKS_STATE_V1',state:'unavailable',approvals:0,applied:0});
  assert.equal(r['2232677'].binding.state,'unlinked');assert.deepEqual(r['2232677'].binding.unitIds,[]);        // no identity is invented
  assert.equal(r['2232677'].binding.reason,'Product ID identity label changed; confirm before linking');
 }
});
test('a board is never saved from a map whose approvals source was unavailable; the last completed board stays',()=>{
 const f=fieldProductFixture();
 const ok=completedBoard(f.health,{...f.field,ownerApprovedLinks:{contract:'COS_OWNER_PRODUCT_LINKS_STATE_V1',state:'ready',approvals:2,applied:2}},f.connections,null,f.now);
 assert.deepEqual(ok.counts,completedBoard(f.health,f.field,f.connections,null,f.now).counts);                 // a ready source, or a map from before this change, saves as usual
 for(const state of ['unavailable','other',undefined])assert.throws(()=>completedBoard(f.health,{...f.field,ownerApprovedLinks:{contract:'COS_OWNER_PRODUCT_LINKS_STATE_V1',state}},f.connections,null,f.now),/owner_link_source_unavailable/);
 assert.throws(()=>completedBoard(f.health,{...f.field,ownerApprovedLinks:null},f.connections,null,f.now),/owner_link_source_unavailable/);
 assert.ok(readFileSync(new URL('../../supabase/functions/cos-operations-pages/savedFleetBoard.mjs',import.meta.url),'utf8').includes('owner_link_source_unavailable'));
});
const fleet=(recs,approved,u)=>{const applied=projectMhelpUploadPlacement(map(u),upload(recs),[],undefined,now,{ownerApprovedLinks:approved});
 const effective=projectEffectiveFleetPlacement(projectCurrentTrackerPlacement(applied.snapshot,[]),[],{authorizedUploadPlacements:applied.authorities});return projectCombinedFleetRoster(effective,[]);};
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}return v;};
test('actual Fleet behaviour: the approved A# and its COS record become one roster entry; no health is claimed; inputs are not modified',()=>{
 const u=freeze(units()),recs=freeze(records(u)),approved=freeze(links());
 const before=fleet(recs,[],u),after=fleet(recs,approved,u);                                                    // frozen inputs: any write to a native record would throw
 const entry=(result,pid)=>result.fleetRoster.items.filter(i=>i.productIds.includes(pid));
 for(const [pid,n] of [['2232677',1],['2221820',2]]){
  assert.equal(entry(before,pid).length,1);assert.equal(entry(before,pid)[0].unitId,null);assert.equal(entry(before,pid)[0].kind,'source_equipment');        // before: a source-only record with no COS unit
  assert.equal(before.fleetRoster.items.filter(i=>i.unitId===id(n)).length,1);                                   // and the COS record listed separately: the same unit counted twice
  const [item]=entry(after,pid);assert.equal(entry(after,pid).length,1);assert.equal(item.kind,'unit');assert.equal(item.unitId,id(n));assert.deepEqual(item.productIds,[pid]);assert.equal(item.placement,'field');
  assert.equal(after.fleetRoster.items.filter(i=>i.unitId===id(n)).length,1);
 }
 assert.equal(after.fleetRoster.items.length,before.fleetRoster.items.length-2);                                // two duplicates removed, nothing else
 const rest=r=>r.fleetRoster.items.filter(i=>!['2232677','2221820'].some(p=>i.productIds.includes(p))&&![id(1),id(2)].includes(i.unitId));
 assert.deepEqual(rest(after),rest(before));
 // Health: the link gives the Field A# a COS unit to report on. It supplies no online/offline reading.
 const roster=readRecordedRoster(after.fleetRoster,after.inventoryItems).roster,empty=Object.assign(snapshot([]),{identityVersion:1,unitIdentities:[],identityWarnings:[]});
 const health=mhelpFieldHealth(after.uploadInventory,roster,fleetDashboardRows(after.inventoryItems,empty,[],null,now),now);
 for(const pid of ['2232677','2221820']){const p=health.items.find(x=>x.productId===pid);assert.ok(!['online','offline'].includes(p.state),p.state);assert.notEqual(p.state,'review');}
 assert.equal(health.counts.online,0);assert.equal(health.counts.offline,0);
 // Revoking (the approvals list no longer carries it) reads back exactly as before the approval.
 const revoked=fleet(recs,[approved[1]],u);assert.deepEqual(entry(revoked,'2232677'),entry(before,'2232677'));assert.equal(entry(revoked,'2221820')[0].unitId,id(2));
 assert.deepEqual(fleet(recs,[],u),before);
});
