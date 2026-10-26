// Isolated contract/auth tests. All remote services use injected in-memory transports.
// Uses the unchanged bridge's configured auth-map constants, but all transport records are synthetic and in memory.
import assert from 'node:assert/strict';
import vm from 'node:vm';import fs from 'node:fs';
import {prepare} from '../scripts/prepare-placement-cpu.mjs';
const capture=process.env.COS_CPU_DEPLOYED_CAPTURE;if(!capture)throw Error('Set COS_CPU_DEPLOYED_CAPTURE to a fresh v123 capture');
const v=JSON.parse(fs.readFileSync(capture));
function boot(code){const context=vm.createContext({console,crypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-10-26T13:00:00Z']));}static now(){return Date.parse('2026-10-26T13:00:00Z');}},fetch:()=>{throw Error('Unmocked fetch')},Deno:{env:{get:()=>undefined},serve:()=>{}}});
vm.runInContext(code.replace('import{importPKCS8,SignJWT}from"jose";','const importPKCS8=()=>{throw Error("Forbidden signing")};const SignJWT=class {};'),context);return context.createOperationsHandler;}
const ownerId = 'e4abc521-1ef3-45a6-9829-b87faff78210';
const actorId = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const recordId = 'a2345678-1234-1234-1234-123456789abc';
const technicians = {
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc': {actorId:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',roleCode:'it_technician'},
  'b7cc3cbf-d11e-4d4a-9742-c07701857911': {actorId:'3caf7c00-627f-445f-bce4-ddeae574ee5c',name:'Victor Garcia',department:'it',roleCode:'it_technician'},
  '78e54fbd-c2db-4d18-8e3d-a9740adcf285': {actorId:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',roleCode:'service_technician'},
  '49dce28e-099a-40bb-a8d8-b39f9ffbabee': {actorId:'1a7d3523-8a3c-488a-9216-4e37f4f7ecb9',name:'Josh Mireles',department:'service',roleCode:'service_technician'},
};
const orgId = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const origin = 'https://cypressriveroasis2023-sudo.github.io';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function transport(scenario, calls) {
  const technician = technicians[scenario.userId];
  const mappedActor = technician?.actorId || actorId;
  return async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/auth/v1/user')) return scenario.invalidToken ? json({message:'Invalid JWT'},401) : json({id:scenario.userId || ownerId});
    if (url.includes('/rest/v1/profiles?')) return json([{user_id:scenario.userId || ownerId,full_name:scenario.legacyName || technician?.name || 'Owner',role:scenario.role || technician?.department || 'owner',active:!scenario.inactive,archived_at:scenario.archived ? '2026-01-01' : null}]);
    if (url.includes('/rest/v1/user_profiles?')) return json([{user_id:mappedActor,display_name:scenario.platformName || technician?.name || 'Owner',active:!scenario.actorInactive,department:scenario.actorDepartment || technician?.department || 'owner'}]);
    if (url.includes('/rest/v1/user_roles?')) return json(scenario.roleRevoked ? [] : [{role_id:recordId,roles:{code:scenario.wrongRole ? 'owner' : technician?.roleCode || 'owner',organization_id:scenario.wrongRoleOrg ? recordId : orgId}}]);
    if (url.includes('/rest/v1/visit_assignments?')) return json(scenario.outsideOrg ? [] : [{visit_id:recordId,user_id:scenario.otherAssignee ? actorId : mappedActor,assignment_role:'technician',status:'assigned',assigned_at:'2026-10-04T10:00:00Z',job_visits:{id:recordId,job_id:recordId,visit_number:1,visit_type:'IT_PREP',department:technician?.department || 'it',status:'scheduled',dispatch_status:'ready',scheduled_start:'2026-10-04T15:00:00Z',scheduled_end:'2026-10-04T16:00:00Z',jobs:{job_number:'COS 001',title:'Assigned Job',job_type:'DELIVERY',customers:{name:'Customer'},sites:{name:'Site'}}}}]);
    if (url.includes('/rest/v1/equipment_units?')) return json([]);
    if (url.includes('/rest/v1/vision_vigilant_unit_matches?') || url.includes('/rest/v1/vision_vigilant_devices?') || url.includes('/rest/v1/camera_devices?')) return json([]);
    if (url.endsWith('/rpc/cos_fleet_placement_evidence_v1')) return json([]);
    if (url.endsWith('/rpc/appdeploy_field_map_snapshot')) return json({items:[],inventoryItems:[],summary:{fieldUnits:0},generatedAt:'2026-10-08T00:00:00Z'});
    if (['jobs','equipment_units','owner_tasks','job_visits','quotes','invoices','purchase_orders','customers','sites','equipment_models'].some(table=>url.includes('/rest/v1/'+table+'?'))) return json(scenario.outsideOrg ? [] : [{id:recordId,job_number:'COS 001'}]);
    if(url.endsWith('/rpc/cos_fleet_shop_snapshot_v1'))return json({contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[]});
    if (url.endsWith('/rpc/cos_owner_identity_snapshot')) return json({revision:'a'.repeat(64),nativeEpochs:[],claims:[]});
    if (url.includes('/rest/v1/rpc/')) {
      if (scenario.rpcDenied) return json({message:'Native department or workflow guard rejected the request'},400);
      if (url.endsWith('/rpc/cos_technician_visible_visits')) {
        const payload=JSON.parse(init.body);
        assert.equal(payload.p_actor_user_id,mappedActor);assert.equal(payload.p_organization_id,orgId);assert.deepEqual(payload.p_visit_ids,[recordId]);
        return json(scenario.otherAssignee?[]:[recordId]);
      }
      if (url.endsWith('/rpc/appdeploy_technician_visit_snapshot')) return json({visit:{id:recordId},execution:{id:recordId,status:'not_started'},current_step:{title:'Native Step',instruction:'Native instruction',step_type:'yes_no',validation_schema:{hidden:true},evidence_requirements:{hidden:true}}});
      if (url.endsWith('/rpc/appdeploy_owner_jobs_snapshot')) return json({items:[{id:recordId,visitId:recordId,jobNumber:'COS 001'}]});
      return json({items:[],ok:true,id:recordId});
    }
    throw new Error('Unhandled mock route: '+url);
  };
}
function request(path, method='GET', body={}, headers={}) {
  return new Request('https://platform.example/functions/v1/cos-operations-pages',{
    method:'POST',
    headers:{Authorization:'Bearer test-owner-token','Content-Type':'application/json',Origin:origin,...headers},
    body:JSON.stringify({path,method,body}),
  });
}


const units=Array.from({length:1001},(_,i)=>({id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),unitNumber:'RECON '+(i+1),unit_number:'RECON '+(i+1),readOnly:false,_sourceField:false,organization_id:orgId,placement:'SHOP',status:'shop',currentLocationType:'shop'}));
const devices=Array.from({length:739},(_,i)=>({id:String(i+1),unit_key:'RECON '+(i+1),source:'vigilant_control_center',device_type:'IPC',device_serial:'synthetic'+i,external_device_id:'synthetic'+i,device_name:'Synthetic '+i,organization:'ROOT',activation_state:'active',source_status:'online'}));
const upload={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,recordCount:1001,apiMissingRecords:[],reviewed:true,sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),receivedAt:'2026-10-26T00:00:00Z',receivedAtPrecision:'second',exportAsOf:null,records:units.map((u,i)=>({productId:String(i+1),unitNumber:u.unitNumber,category:'Recon',customerId:'1',customer:'Fixture customer',sourceAddress:{street:'1 Fixture Street',city:'Houston',state:'TX',zip:'77001'},sourceRow:i+2,placement:i<284?'FIELD':'SHOP',lifecycle:'UNFLAGGED',binding:{productId:String(i+1),trackerId:null,trackerLabel:null,nativeUnitId:u.id,nativeLabel:u.unitNumber,fullLabel:u.unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:'c'.repeat(64),expectedGuard:'d'.repeat(64),guardCurrent:true}}))};
const audits=Array.from({length:54},(_,i)=>({id:String(i+1),unit_key:'RECON '+(i%7+1),device_ids:[String(i%7+1)],contract:i>=47?'COS_CAMERA_PLACEMENT_V2':null,placement:'SHOP',action:'MOVE_TO_ROOT',created_at:'2026-10-25T00:00:00Z',request_id:recordId,control_id:'99999999-9999-4999-8999-'+String(i%7+1).padStart(12,'0')}));
const calls=[],base=transport({},calls);let outage=false,scenario='load';

const fetch=async(url,init)=>{
 if(outage&&url.endsWith('/rpc/appdeploy_field_map_snapshot'))return json({message:'Synthetic source unavailable'},503);
 if(url.includes('/camera_health_current?')||url.includes('/equipment_master?')||url.includes('/camera_integrations?'))return json([]);
 if(url.endsWith('/rpc/cos_fleet_placement_evidence_v1'))return json(audits.map(a=>scenario==='newer-history'?{...a,created_at:'2026-10-26T12:00:00Z'}:a).reverse());
 if(url.includes('/equipment_units?')){const offset=Number(new URL(url).searchParams.get('offset')||0);return json(units.slice(offset,offset+1000));}
 if(url.includes('/camera_devices?'))return json(devices);
 if(url.endsWith('/rpc/appdeploy_field_map_snapshot'))return json({items:[],inventoryItems:units,summary:{fieldUnits:0},generatedAt:'2026-10-26T00:00:00Z'});
 if(url.endsWith('/rpc/cos_geocode_sources_map_projection'))return json([]);
 if(url.endsWith('/rpc/cos_mhelp_placement_snapshot')){const value=structuredClone(upload);if(scenario==='malformed-upload')value.complete=false;if(scenario==='guard-changed')value.records[0].binding.guardCurrent=false;return json({contract:'COS_MHELP_PLACEMENT_V1',items:[],enabled:true,upload:value});}
 if(url.endsWith('/rpc/cos_mhelp_location_snapshot'))return json(null);
 return base(url,init);
};
const variants={baseline:boot(v.files.find(f=>f.name.endsWith('serve.ts')).content),candidate:boot(prepare(v).payload.files.find(f=>f.name.endsWith('serve.ts')).content)};
const report={syntheticOnly:true,productionRequests:0,units:1001,devices:739,audits:54,markedGroups:7,limitations:'Synthetic identity/binding distribution, no database/network latency; not production-trigger attribution',runs:[]};
const outputs=new Map();
for(const [variant,factory] of Object.entries(variants)){
 const handler=factory({platformUrl:'https://platform.example',serviceKey:'synthetic',fetch,mhelpPlacementEnabled:true});
 for(const mode of ['load','repeat','failure','retry','stale','partial','newer-history','guard-changed','malformed-upload']){
  scenario=mode;outage=mode==='failure';for(const d of devices){d.source_status=mode==='partial'?null:'online';d.source_last_seen_at=mode==='stale'?'2026-10-20T00:00:00Z':'2026-10-26T12:55:00Z';}
  for(const path of ['/api/field-map','/api/camera-health/summary-v3']){
   const cpu=process.cpuUsage(),start=performance.now(),response=await handler(request(path)),body=await response.json(),usage=process.cpuUsage(cpu);
   const key=mode+path;if(variant==='baseline')outputs.set(key,{status:response.status,body});else assert.deepEqual({status:response.status,body},outputs.get(key));
   if(!['failure','malformed-upload'].includes(mode))assert.equal(response.status,200,JSON.stringify(body));
   report.runs.push({variant,mode,path,status:response.status,cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start,inventory:body.inventoryItems?.length,responseBytes:Buffer.byteLength(JSON.stringify(body)),census:body.fleetRoster?.summary});
  }
 }
}
const handlers=Object.fromEntries(Object.entries(variants).map(([name,factory])=>[name,factory({platformUrl:'https://platform.example',serviceKey:'synthetic',fetch,mhelpPlacementEnabled:true})]));
scenario='load';outage=false;report.alternating=[];
for(let round=0;round<7;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){
 const start=performance.now(),cpu=process.cpuUsage();const response=await handlers[variant](request('/api/field-map'));const body=await response.json(),usage=process.cpuUsage(cpu);assert.equal(response.status,200);
 if(round>0)report.alternating.push({round,variant,cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start});
 assert.equal(body.fleetRoster.summary.totalRecords,1001);assert.equal(body.fleetRoster.summary.field,284);assert.equal(body.fleetRoster.summary.shop,717);
}
fs.writeFileSync('/tmp/cos-startup-profile.json' ,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
