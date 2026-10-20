import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

// Exercise the actual flattened deployment entry, including import.meta.main.
// The child VM has synthetic identity/data only and rejects all unexpected IO.
const source=buildSync({
  entryPoints:[fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/serve.ts',import.meta.url))],
  nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))],
  bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,
}).outputFiles[0].text;

async function verify(main,source){
  const vm=await import('node:vm'),assert=(await import('node:assert/strict')).default;
  const handlers=[],calls=[],id='00000000-0000-4000-8000-000000000051';
  let active=true;
  const row={id,unitNumber:'Synthetic Tracker 051',readOnly:true,_sourceField:true,placement:'FIELD',status:'field',currentLocationType:'field',latitude:null,longitude:null,hasUnitGps:false,installedSiteId:null,address:'Synthetic installation'};
  const snapshot={items:[row],inventoryItems:[row],summary:{fieldUnits:1,mappedUnits:0,missingGps:1,addressUnits:1}};
  const saved=JSON.stringify(snapshot),json=value=>new Response(JSON.stringify(value));
  const receipt={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:new Date().toISOString(),items:[{trackerId:id,nativeUnitId:null,trackerLabel:row.unitNumber,nativeLabel:null,state:'held',guardCurrent:true,placement:null,observedAt:new Date().toISOString(),reason:'service_location_unverified'}]};
  const transport=async url=>{
    calls.push(String(url));
    if(url.includes('/auth/v1/user'))return json({id:'e4abc521-1ef3-45a6-9829-b87faff78210'});
    if(url.includes('/rest/v1/profiles?'))return json([{user_id:'e4abc521-1ef3-45a6-9829-b87faff78210',full_name:'Synthetic Owner',role:'owner',active,archived_at:null}]);
    if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',display_name:'Synthetic Owner',department:'owner',active}]);
    if(url.includes('/rest/v1/user_roles?'))return json([{roles:{code:'owner',organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);
    if(url.endsWith('/rpc/appdeploy_field_map_snapshot'))return json(snapshot);
    if(url.endsWith('/rpc/cos_fleet_shop_snapshot_v1'))return json({contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[]});
    if(url.endsWith('/rpc/cos_owner_identity_snapshot'))return json({revision:'a'.repeat(64),claims:[]});
    if(url.endsWith('/rpc/cos_mhelp_placement_snapshot'))return json(receipt);
    if(/\/(?:camera_devices|equipment_units|vision_vigilant_unit_matches|vision_vigilant_devices)\?/.test(url))return json([]);
    if(/\/(?:cos_fleet_placement_evidence_v1|cos_geocode_sources_map_projection|cos_archived_representation_projection|cos_source_recorded_coordinates_read_many)$/.test(url))return json([]);
    throw Error('Unexpected synthetic transport '+url);
  };
  const context=vm.createContext({URL,URLSearchParams,Request,Response,Headers,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,atob,btoa,fetch:transport,console:{log(){},warn(){},error(){}},Deno:{
    env:{get:name=>name==='SUPABASE_URL'?'https://synthetic.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-only':undefined},
    serve:handler=>{handlers.push(handler);return{finished:Promise.resolve()};},
  }});
  const mod=new vm.SourceTextModule(source,{context,initializeImportMeta:meta=>{meta.main=main;}});
  await mod.link(name=>{throw Error('Unexpected external module '+name);});
  await mod.evaluate({timeout:5000});
  assert.equal(handlers.length,1,'the deployment entry must register exactly one request handler');
  const request=(path,auth=true)=>new Request('https://synthetic.invalid',{method:'POST',headers:{...(auth?{Authorization:'Bearer synthetic-only'}:{}),'Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method:'GET',body:null})});
  assert.equal((await handlers[0](request('/api/field-map',false))).status,401);
  const response=await handlers[0](request('/api/field-map'));
  assert.equal(response.status,200,await response.clone().text());
  const map=await response.json();
  assert.equal(map.items.length,1,'a service-location read failure retains existing recorded placement');
  assert.equal(map.inventoryItems[0].placement,'FIELD');
  assert.equal(map.inventoryItems[0].effectivePlacement.freshness,'recorded');
  assert.equal(map.inventoryItems[0].latitude,null,'retained placement never promotes a stale point');
  for(const reason of [undefined,'equipment_missing','identity_or_lifecycle_changed','customer_unverified']){
    receipt.items[0].reason=reason;
    const held=await handlers[0](request('/api/field-map'));assert.equal(held.status,200);const value=await held.json();
    assert.equal(value.items.length,0,'missing or conflicting placement evidence must still remove FIELD presentation');
    assert.equal(value.inventoryItems[0].placement,'UNKNOWN');
  }
  // The actual bundled API must run the complete upload/finalizer/roster seam.
  receipt.items[0].reason='service_location_unverified';
  receipt.items[0].observedAt=new Date(Date.now()-3*3600000).toISOString();
  const receivedAt=new Date(Date.now()-60000).toISOString(),sha='a'.repeat(64);
  receipt.upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt,receivedAtPrecision:'second',exportAsOf:null,records:[{productId:'101',unitNumber:row.unitNumber,category:'Synthetic',customerId:'11',customer:'Synthetic customer',sourceAddress:{},sourceRow:2,placement:'FIELD',lifecycle:'DO_NOT_USE',binding:{productId:'101',trackerId:id,trackerLabel:row.unitNumber,nativeUnitId:null,nativeLabel:null,fullLabel:row.unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:sha,expectedGuard:sha,guardCurrent:true}}]};
  const uploadedResponse=await handlers[0](request('/api/field-map'));assert.equal(uploadedResponse.status,200,await uploadedResponse.clone().text());
  const uploaded=await uploadedResponse.json();assert.equal(uploaded.items.length,0);assert.equal(uploaded.inventoryItems[0].placement,'FIELD');assert.equal(uploaded.inventoryItems[0].activeInventoryEligible,false);assert.equal(uploaded.fleetRoster.summary.field,0);assert.equal(uploaded.fleetRoster.summary.excludedLifecycle,1);
  assert(calls.some(url=>url.endsWith('/rpc/cos_mhelp_placement_snapshot')));
  assert.equal(JSON.stringify(snapshot),saved,'projection must not mutate saved input');
  const session=await handlers[0](request('/api/session'));
  assert.equal(session.status,200);
  assert.equal((await session.json()).features.vrmRead,true);
  active=false;
  assert.equal((await handlers[0](request('/api/field-map'))).status,403);
}

for(const main of [false,true])test(`bundled operations entry registers once and preserves placement/auth behavior (main=${main})`,()=>{
  const script=`import {readFileSync} from 'node:fs';\nconst {main,source}=JSON.parse(readFileSync(0,'utf8'));\nawait (${verify.toString()})(main,source);`;
  const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{
    input:JSON.stringify({main,source}),encoding:'utf8',timeout:15000,
  });
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr||result.stdout);
});
