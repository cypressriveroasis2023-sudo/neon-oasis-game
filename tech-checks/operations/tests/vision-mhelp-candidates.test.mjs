import test from 'node:test';
import assert from 'node:assert/strict';
import {readMhelpCandidates,candidateForSourceUnit} from '../../supabase/functions/onsite-vision-agent/visionMhelpCandidates.ts';
import {projectVisionFleet} from '../../supabase/functions/onsite-vision-agent/fleetIntelligence.ts';
import {verifiedVisionFieldFleet} from '../../supabase/functions/onsite-vision-agent/visionFieldAuthority.ts';
const NOW=Date.parse('2026-10-23T18:15:00Z');
const received=new Date(NOW-60_000).toISOString();
const hex='a'.repeat(64);
const mk=(id,name,placement,customer,address)=>{
  const upload={recordId:'mhelp_product:'+id,productId:id,unitNumber:name,placement,
    uploadLifecycle:'UNFLAGGED',binding:{unitIds:[],candidateUnitIds:[],state:'unlinked'}};
  const roster={id:'mhelp_product:'+id,kind:'source_equipment',unitNumber:name,productIds:[id],active:true,
    lifecycle:'active',placement:placement.toLowerCase(),customer,sourceAddress:address,
    source:'owner_supplied_mhelp_export'};
  return {upload,roster};
};
function map(rows){
  const n=rows.length;
  return {generatedAt:received,items:[],inventoryItems:[],summary:{fieldUnits:0},
    uploadInventory:{contract:'COS_MHELP_UPLOAD_INVENTORY_V1',sourceSha256:hex,receivedAt:received,
      records:rows.map(x=>x.upload),summary:{totalRecords:n}},
    fleetRoster:{contract:'COS_COMBINED_FLEET_ROSTER_V1',items:rows.map(x=>x.roster),summary:{totalRecords:n}}};
}
const shop=mk('2259013','SOLAR SPOTTER 029','SHOP','Cameras OnSite','9949 W Sam Houston Pkwy N, Houston');
const field=mk('2291292','RANGER 020','FIELD','Big Bear Storage','14531 Huffmeister Rd, Houston');
const variant=mk('2237636','Spotter 260HD','FIELD','Customer','110 Twistleaf, Buda, TX');
function legacyHealth(){
  const row={id:182,name:'Ranger 020',unit:'RANGER 020',type:'IPC',organization:'Big Bear Storage',
    scope:'field',status:'offline',activationState:'ACTIVE',evidence:{
      kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'offline',
      observedAt:received,lastOnlineAt:new Date(NOW-3600_000).toISOString()}};
  return {evidenceVersion:2,refreshedAt:received,rows:[row],totalDevices:1,fieldDevices:1,shopRoot:0,
    online:0,offline:1,review:0,
    inventory:{allRecords:1,activeFieldRecords:1,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
}
test('Exact mHelp Product-ID match provides a placement CANDIDATE, not a camera identity',()=>{
  const x=readMhelpCandidates(map([shop,field]),NOW);
  const f=candidateForSourceUnit('RANGER 020',x);
  assert.equal(f.state,'exact_mhelp_product_candidate');
  assert.equal(f.product_id,'2291292');
  assert.equal(f.placement,'FIELD');
  assert.match(f.basis,/NOT VERIFIED/);
  const s=candidateForSourceUnit('SOLARSPOTTER 029',x);
  assert.equal(s.product_id,'2259013');assert.equal(s.placement,'SHOP');
  assert.equal(candidateForSourceUnit('Spotter 029',x),null);
});
test('Unlinked Star4Live camera with mHelp FIELD Product ID remains placement review',()=>{
  const m=map([field]),health=legacyHealth();
  const raw=projectVisionFleet(health,m,{scope:'summary',unit_reference:'',location_query:'',limit:100},NOW,{allPlacements:true});
  const after=verifiedVisionFieldFleet(raw,health,m,{scope:'offline',unit_reference:'',location_query:'',limit:100},NOW);
  assert.equal(after.monitored_cameras.offline,0);
  assert.equal(after.review_items.length,1);
  assert.equal(after.review_candidate_field_source_count,1);
  assert.equal(after.review_items[0].placement,'needs_review');
  assert.equal(after.review_items[0].location,null);
  assert.equal(after.review_items[0].mhelp_product_candidate.product_id,'2291292');
  assert.equal(after.review_items[0].mhelp_product_candidate.customer,'Big Bear Storage');
});
test('Provider label without a suffix never inherits a different HD/HDC2 physical unit',()=>{
  const x=readMhelpCandidates(map([variant]),NOW),c=candidateForSourceUnit('Spotter 260',x);
  assert.equal(c.state,'unit_variant_review');
  assert.equal(c.mhelp_unit,'Spotter 260HD');
  assert.equal(c.product_id,'2237636');
  assert.equal(c.placement,null);
  assert.equal(c.customer,null);
  assert.equal(c.source_address,null);
  assert.equal(candidateForSourceUnit('Ranger 260',x),null);
});
test('Conflicting upload-vs-current placement cannot create a positive candidate',()=>{
  const altered={...field,roster:{...field.roster,placement:'shop'}};
  const x=readMhelpCandidates(map([altered]),NOW),c=candidateForSourceUnit('RANGER 020',x);
  assert.notEqual(c?.state,'exact_mhelp_product_candidate');
  assert.equal(c?.placement??null,null);
});
test('Malformed or duplicate primary Product IDs yield no positive candidates',()=>{
  const duplicate=map([field,{...shop,upload:{...shop.upload,productId:'2291292',recordId:'mhelp_product:2291292'}}]);
  assert.equal(readMhelpCandidates(duplicate,NOW).size,0);
  const duplicatedRoster=map([field,{...shop,roster:{...shop.roster,productIds:['2291292']}}]);
  assert.equal(readMhelpCandidates(duplicatedRoster,NOW).size,0);
  const future=map([field]);future.uploadInventory.receivedAt=new Date(NOW+60000).toISOString();
  assert.equal(readMhelpCandidates(future,NOW).size,0);
  const unknown=map([field]);unknown.uploadInventory.sourceSha256='not_sha';
  assert.equal(readMhelpCandidates(unknown,NOW).size,0);
});
test('Related suffix siblings stay separate, even with the same number and family',()=>{
  const x=readMhelpCandidates(map([shop, mk('2299999','Solar Spotter 029HDC2','FIELD','Another','Another')]),NOW);
  assert.equal(candidateForSourceUnit('SOLARSPOTTER 029',x).product_id,'2259013');
  assert.equal(candidateForSourceUnit('SOLARSPOTTER 029HDC2',x).product_id,'2299999');
  assert.equal(candidateForSourceUnit('SOLARSPOTTER 029HD4',x).state,'ambiguous_source_products');
});
test('Absent protected mHelp roster produces no customer or address guesses',()=>{
  assert.equal(readMhelpCandidates({},NOW).size,0);
  assert.equal(candidateForSourceUnit('RANGER 020',new Map()),null);
});
