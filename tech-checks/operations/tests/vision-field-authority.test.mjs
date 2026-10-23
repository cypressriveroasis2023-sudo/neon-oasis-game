import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectVisionFleet} from '../../supabase/functions/onsite-vision-agent/fleetIntelligence.ts';
import {verifiedVisionFieldFleet} from '../../supabase/functions/onsite-vision-agent/visionFieldAuthority.ts';

const NOW=Date.parse('2026-10-23T17:00:00Z');
const time=new Date(NOW-60000).toISOString();
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const proof='a'.repeat(64);
const query=(q={})=>({scope:'offline',unit_reference:'',location_query:'',limit:60,...q});
const camera=(id,unit,name,org,status='offline',scope='field')=>({
  id,name,unit,organization:org,type:'IPC',scope,activationState:'ACTIVE',
  status:scope==='field'?status:'review',
  evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status,
    observedAt:time,lastOnlineAt:new Date(NOW-86400000).toISOString()}
});
const shop={id:uid(1),unitNumber:'Solar Spotter 029',placement:'SHOP',currentLocationType:'shop',
  status:'available',activeInventoryEligible:true,
  effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'shop'}};
const field={id:uid(2),unitNumber:'Ranger 020',placement:'FIELD',currentLocationType:'field',
  status:'field',activeInventoryEligible:true,
  effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'field'},
  customer:'Verified Customer',site:'Verified Site',address:'100 Verified Road, Houston, TX'};
const claim=(unit,ids,keys)=>({
  unitId:unit.id,unitNumber:unit.unitNumber,kind:'native_provider',
  deviceIds:ids.map(String),unitKeys:keys,proof
});
const rows=[
 ...[155,156,157,158].map((id,i)=>camera(id,'SOLARSPOTTER 029','SolarSpotter 029_'+(i+1),'Hyperion - Enchanted Rock')),
 camera(200,'RANGER 020','Ranger 020','Big Bear Storage')
];
function source(savedRows=rows,claims=[
  claim(shop,[155,156,157,158],['SOLARSPOTTER 029']),
  claim(field,[200],['RANGER 020'])
]){
 const count=savedRows.filter(r=>r.scope==='field').length;
 const health={evidenceVersion:2,rows:savedRows,totalDevices:savedRows.length,
   refreshedAt:time,fieldDevices:count,shopRoot:savedRows.filter(r=>r.scope==='shop').length,
   online:savedRows.filter(r=>r.scope==='field'&&r.status==='online').length,
   offline:savedRows.filter(r=>r.scope==='field'&&r.status==='offline').length,
   review:savedRows.filter(r=>r.scope==='field'&&r.status==='review').length,
   inventory:{allRecords:savedRows.length,activeFieldRecords:count,
     activeShopRecords:savedRows.filter(r=>r.scope==='shop').length,
     inactiveRecords:0,unknownScopeRecords:savedRows.filter(r=>r.scope==='unknown').length},
   identityVersion:1,unitIdentities:claims,identityWarnings:[]};
 const map={generatedAt:time,effectivePlacementVersion:1,
   inventoryItems:[shop,field],items:[field],summary:{fieldUnits:1}};
 const raw=projectVisionFleet(health,map,{scope:'summary',unit_reference:'',location_query:'',limit:5000},NOW,{allPlacements:true});
 return {health,map,raw};
}
const classifySource=(f=source(),q=query())=>verifiedVisionFieldFleet(f.raw,f.health,f.map,q,NOW);
test('Four offline SolarSpotter 029 channels in recorded SHOP never appear as Field outages',()=>{
 const d=classifySource();
 assert.equal(d.provider_source_counts.cameras.offline,5);
 assert.deepEqual(d.monitored_cameras,{total:1,online:0,offline:1,unverified:0});
 assert.equal(d.shop_or_inactive_counts.cameras.offline,4);
 assert.equal(d.items.length,1);
 assert.equal(d.items[0].unit,'RANGER 020');
 assert.equal(d.items[0].location.address,'100 Verified Road, Houston, TX');
 assert.equal(d.review_items.length,0);
 assert.equal(d.shop_or_inactive_resource_count,4);
});
test('Star4Live customer-named folder with no verified identity stays in placement review',()=>{
 const f=source();
 f.health.identityVersion=1;
 f.health.unitIdentities=f.health.unitIdentities.filter(x=>x.unitId!==shop.id);
 const d=classifySource(f);
 assert.equal(d.monitored_cameras.offline,1);
 assert.equal(d.placement_review_counts.cameras.offline,4);
 assert.equal(d.shop_or_inactive_counts.cameras.offline,0);
 assert.equal(d.review_items.length,4);
 assert.equal(d.review_items[0].location,null);
 assert.match(d.review_items[0].provider_customer_folder,/Enchanted Rock/);
 assert.equal(d.review_items[0].placement,'needs_review');
});
test('Field status is not manufactured from the Star4Live folder when COS map is unavailable',()=>{
 const f=source();f.map=null;
 const d=classifySource(f);
 assert.equal(d.field_placement_verified,false);
 assert.equal(d.monitored_cameras.total,0);
 assert.equal(d.placement_review_counts.cameras.offline,5);
 assert.match(d.field_placement_note,/could not be verified/i);
});
test('No suffix or numbered asset cross-link by similar label or customer organization',()=>{
 const f=source();
 const suffixed={...shop,id:uid(3),unitNumber:'Solar Spotter 029HDC2',
   effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'field'},
   placement:'FIELD',currentLocationType:'field',customer:'Unrelated',site:'Unrelated',address:'Different site'};
 f.map={generatedAt:time,effectivePlacementVersion:1,
   items:[field,suffixed],inventoryItems:[field,suffixed],
   summary:{fieldUnits:2}};
 // No exact eligible proof links the 029 provider cameras to 029HDC2.
 const d=classifySource(f);
 assert.equal(d.monitored_cameras.offline,1);
 assert.equal(d.placement_review_counts.cameras.offline,4);
 assert.equal(d.review_items[0].location,null);
});
test('Complete provider identity can correct a heuristic SHOP scope when current COS proves FIELD',()=>{
 const changed=rows.map(row=>row.id===200?{...row,scope:'shop',status:'review'}:row);
 const f=source(changed);
 const d=classifySource(f);
 assert.equal(d.monitored_cameras.offline,1);
 assert.equal(d.items[0].unit,'RANGER 020');
});
test('Conflicting linked resource IDs and map snapshot contradiction fail closed',()=>{
 const f=source();
 f.health.unitIdentities.push(claim(field,[155,156,157,158],['SOLARSPOTTER 029']));
 const conflict=classifySource(f);
 assert.equal(conflict.monitored_cameras.total,1);
 assert.equal(conflict.placement_review_counts.cameras.offline,4);
 const g=source();
 g.map.items=[shop,field];g.map.summary.fieldUnits=2;
 const stale=classifySource(g);
 assert.equal(stale.field_placement_verified,false);
 assert.equal(stale.monitored_cameras.total,0);
});
test('Vision screen shows raw offline Shop numbers separately from confirmed Field totals',()=>{
 const script=readFileSync(new URL('../../onsite-vision-fleet-data.js',import.meta.url),'utf8');
 const ctx=vm.createContext({Date,Intl,console});
 vm.runInContext(script,ctx);
 const d=classifySource();
 const html=ctx.OnSiteVisionFleetData.render(d,{scope:'offline'});
 assert.match(html,/Confirmed Field camera records/);
 assert.match(html,/Shop\/inactive exclusion|verified Shop\/inactive exclusion/);
 assert.match(html,/All saved provider camera statuses/);
 assert.match(html,/Ranger 020/i);
 assert.doesNotMatch(html,/SolarSpotter 029_1/); // Shop camera does not show in Field rows
});
test('Unverified provider candidates show customer-folder hints but are not Field locations',()=>{
 const script=readFileSync(new URL('../../onsite-vision-fleet-data.js',import.meta.url),'utf8');
 const ctx=vm.createContext({Date,Intl,console});
 vm.runInContext(script,ctx);
 const f=source();f.health.unitIdentities=f.health.unitIdentities.slice(1);
 const d=classifySource(f);
 const html=ctx.OnSiteVisionFleetData.render(d,{scope:'offline'});
 assert.match(html,/FIELD NOT VERIFIED/);
 assert.match(html,/Hyperion - Enchanted Rock/);
 assert.match(html,/PLACEMENT REVIEW/);
 assert.equal(d.review_items[0].location,null);
});
