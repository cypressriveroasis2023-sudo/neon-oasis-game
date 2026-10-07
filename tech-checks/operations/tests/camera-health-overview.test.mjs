import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context=vm.createContext({Intl,Date});for(const file of ['camera-health-history.js','camera-health-overview.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context);
const api=context.CameraHealthOverview,now=Date.parse('2026-10-06T16:10:00Z');
const device={source:'reconeyez',unit_key:'RII-028',source_metadata:{area:'Exact vendor area'}};
const event={id:1,external_device_id:'BRIDGE-1',component_guid:'BRIDGE-1',component_type:'bridge_4g',component_name:'Bridge A',component_area:'Exact vendor area',observed_at:'2026-10-06T16:00:00Z',event_type:'YC',battery_percent:7};
test('bridge mapping requires an exact unique provider area, no fuzzy names or fallback',()=>{
 assert.equal(api.mappedArea('RII-028',[device]),'Exact vendor area');assert.equal(api.mappedArea('RII-028',[{...device,source_metadata:{}}]),null);
 assert.equal(api.mappedArea('RII-028',[device,{...device,unit_key:'RII-029'}]),null);
 assert.equal(api.mappedArea('RII-028',[device,{...device,source_metadata:{area:'Exact vendor area renamed'}}]),null);
});
test('bridge observations use source event order and never arrival order',()=>{
 const value=api.component([event,{...event,id:9,observed_at:'2026-10-06T15:00:00Z',event_type:'RP'}],event.component_area,now);
 assert.equal(value.state,'offline');assert.equal(value.battery,7);assert.equal(value.type,'Bridge');assert.match(api.componentHtml(value),/Critical/);
 const moved={...event,id:2,observed_at:'2026-10-06T16:05:00Z',component_area:'Different unit'};assert.equal(api.component([event,moved],event.component_area,now),null);
});
test('stale, future, missing, invalid and conflicting evidence cannot claim current online',()=>{
 for(const time of ['2026-10-06T15:00:00Z','2030-01-01T00:00:00Z',null,'bad']){const value=api.component([{...event,event_type:'RP',observed_at:time}],event.component_area,now);assert.equal(value.state,'unknown')}
 assert.equal(api.component([event,{...event,id:2,event_type:'RP'}],event.component_area,now).state,'unknown');
 assert.equal(api.component([{...event,component_guid:'WRONG'}],event.component_area,now),null);
});
test('sirens stay distinct, detector rows are not used and absent battery is not zero',()=>{
 assert.equal(api.component([{...event,component_type:'siren_v1',battery_percent:null}],event.component_area,now).battery,null);
 assert.equal(api.component([{...event,component_type:'siren_v1'}],event.component_area,now).type,'Siren');
 assert.equal(api.component([{...event,component_type:'detector_hdr_xrl'}],event.component_area,now),null);
});
test('unit cards contain basic info only and escape provider text',()=>{
 const html=api.card({k:'UNIT <ONE>',state:'online',ds:[{organization:'Site <X>'}]},{effectiveHealth:()=> 'online',cameraGroup:()=> 'Reconeyez',isShop:()=>false});assert.match(html,/UNIT &lt;ONE&gt;/);assert.doesNotMatch(html,/time-history|send-root|Recent Status|Live Event|diagnostic-tabs/);assert.match(html,/View unit details/);
});
test('equal-time type or identity disagreement, invalid newer records and generic activity fail closed',()=>{
 for(const change of [{component_type:'siren_v1'},{component_guid:'WRONG'},{component_area:'Moved'}]){const value=api.component([event,{...event,id:2,...change}],event.component_area,now);assert.ok(value===null||value.state==='unknown')}
 for(const time of ['1970-01-01T00:00:00Z',null,'bad','2030-01-01T00:00:00Z']){const value=api.component([event,{...event,id:2,observed_at:time,event_type:'RP'}],event.component_area,now);assert.equal(value.state,'unknown')}
 for(const type of ['BA','CL','OP','Movement detected','unrecognized'])assert.equal(api.eventStatus(type),'unknown');
});

test('detector movement or area rename invalidates its prior inventory area until reconciled',()=>{
 assert.equal(api.mappedArea('RII-028',[{...device,source_metadata:{area:'Exact vendor area',reconeyez_area:'New provider area'}}]),null);
 assert.equal(api.mappedArea('RII-028',[{...device,source_metadata:{area:'Exact vendor area',reconeyez_area:'Exact vendor area'}}]),'Exact vendor area');
});

test('conflicting observed or inventory area on another unit keeps the join ambiguous',()=>{
 for(const metadata of [{area:'Old area',reconeyez_area:'Exact vendor area'},{area:'Exact vendor area',reconeyez_area:'New area'}]){
  assert.equal(api.mappedArea('RII-028',[device,{...device,unit_key:'RII-029',source_metadata:metadata}]),null);
 }
});

const current={id:1,unit_key:'RANGER 901',organization:'Exact customer site',activation_state:'active',source:'vigilant_control_center',device_type:'IPC',source_status:'offline',source_last_seen_at:'2026-10-06T16:09:00Z'};
test('camera outages require mapped camera provider evidence, never tracker ports or recorders',()=>{
 assert.equal(api.cameraState(current,now),'offline');
 for(const change of [{__trackerOnly:true,__evidence:{status:'offline',checked_at:current.source_last_seen_at}},{source:'2026_unit_tracker'},{device_type:'NVR'},{device_type:null},{device_type:'new infrastructure'},{activation_state:null},{source_last_seen_at:'2026-10-06T15:00:00Z'},{source_last_seen_at:'2030-01-01T00:00:00Z'},{source_last_seen_at:'2026-02-30T10:00:00Z'},{source_status:'garbage'}])assert.notEqual(api.cameraState({...current,...change},now),'offline');
 assert.equal(api.classifyUnit([{...current,device_type:'NVR'}],[],now).state,'offline');assert.equal(api.classifyUnit([{...current,device_type:'NVR'}],[],now).cameraState,'mapping');
 assert.equal(api.classifyUnit([current,{...current,id:2,device_type:'NVR',source_status:'online'}],[],now).state,'degraded');
});
test('placement, activation and observed health remain distinct and fail closed',()=>{
 const tracker=[{source_label:'Ranger 901',tracker_state:'shop'}];
 assert.equal(api.placement(current,tracker),'unknown');assert.equal(api.classifyUnit([current],tracker,now).state,'offline');
 assert.equal(api.placement({...current,organization:'ROOT'},tracker),'shop');assert.equal(api.classifyUnit([{...current,organization:'ROOT'}],tracker,now).state,'shop');
 assert.equal(api.placement({...current,activation_state:'deactivated'},tracker),'inactive');
 assert.equal(api.placement({...current,activation_state:null},[]),'unknown');
 assert.equal(api.placement({...current,organization:'TRACKER FIELD'},[]),'unknown');
 assert.equal(api.placement({...current,unit_key:'RI999 Shop'},[]),'shop');
 assert.equal(api.placement({...current,organization:'Shopper Center'},[]),'field');
 assert.equal(api.placement(current,[{source_label:'RANGER 901 extra',tracker_state:'shop'}]),'field');
 assert.equal(api.placement(current,[{source_label:'RANGER 901',tracker_state:'field_or_unknown'},{source_label:'RANGER 901',tracker_state:'field_or_unknown'}]),'unknown');
 assert.equal(api.classifyUnit([{...current,__trackerOnly:true}],[],now).state,'mapping');
 assert.equal(api.classifyUnit([current,{...current,id:2,organization:'ROOT'}],[],now).scope,'unknown');
});
test('unmapped placeholders have gray mapping labels and no offline camera claim',()=>{
 const d={...current,__trackerOnly:true,__providerLabel:'Witness',organization:'TRACKER · SITE NOT LINKED'};
 const g={k:'SPOTTER 904',ds:[d],...api.classifyUnit([d],[],now)};
 const html=api.card(g,{effectiveHealth:x=>api.cameraState(x,now),cameraGroup:()=> 'Witness',isShop:()=>false});
 assert.match(html,/STATUS UNVERIFIED/);assert.match(html,/Location unverified/);assert.doesNotMatch(html,/statuspill offline|\bOFFLINE\b/);
});
test('malformed and duplicate source identities cannot produce fleet totals',()=>{
 assert.doesNotThrow(()=>api.validateSources([current],[{camera_device_id:1}],[]));
 for(const rows of [[current,current],[{...current,id:null}],[{...current,source_status:{status:'offline'}}]])assert.throws(()=>api.validateSources(rows,[],[]));
 assert.throws(()=>api.validateSources([current],[{camera_device_id:1},{camera_device_id:1}],[]));
 assert.throws(()=>api.validateSources([current],[{camera_device_id:2}],[]));
 assert.throws(()=>api.validateSources([current],[],[{source_label:'X'}]));
});

test('explicit stolen inventory note stays inactive without matching arbitrary site substrings',()=>{assert.equal(api.placement({...current,unit_key:'Stolen from RII-999 on 01/01/2026'},[]),'inactive');assert.equal(api.placement({...current,organization:'Stolen Creek Shopping Center'},[]),'field')});

test('inactive resources and partial camera health cannot create contradictory unit summaries',()=>{
 const ds=[{...current,source_status:'online'},{...current,id:2,activation_state:'deactivated'}];
 const g={k:'TEST',ds,...api.classifyUnit(ds,[],now)};
 assert.equal(g.state,'online');
 const html=api.card(g,{effectiveHealth:d=>api.cameraState(d,now),cameraGroup:()=> 'Vigilant',isShop:()=>false});
 assert.match(html,/1 online · 0 offline · 0 to verify/);
 assert.equal(api.classifyUnit([current,{...current,id:2,source_status:'online'}],[],now).state,'degraded');
});

test('fresh recorder outage stays a separate priority warning without certifying camera health',()=>{const value=api.classifyUnit([{...current,device_type:'NVR'}],[],now);assert.equal(value.state,'offline');assert.equal(value.cameraState,'mapping');assert.equal(value.recorderOffline,true);assert.equal(api.classifyUnit([{...current,device_type:'NVR',source_last_seen_at:'2026-10-06T15:00:00Z'}],[],now).recorderOffline,false)});

test('provider systems count recorders once while camera coverage stays independent',()=>{
 const nvr={...current,device_type:'NVR',source_status:'online'};
 const g=api.classifyUnit([nvr],[],now);assert.equal(g.state,'online');assert.equal(g.providerState,'online');assert.equal(g.cameraState,'mapping');
 const mixed=api.classifyUnit([{...current,source_status:'online'},{...nvr,id:2,source_status:'offline'}],[],now);
 assert.equal(mixed.state,'degraded');assert.equal(mixed.providerState,'degraded');assert.equal(mixed.cameraState,'online');assert.equal(mixed.recorderOffline,true);
 assert.equal(api.classifyUnit([{...current,source_status:'online'},nvr],[],now).state,'online');
 for(const change of [{activation_state:null},{source_last_seen_at:'2030-01-01T00:00:00Z'},{source_last_seen_at:'2026-10-06T15:00:00Z'},{device_type:'router'},{source:'2026_unit_tracker'}])assert.equal(api.providerState({...nvr,...change},now),'verifying');
});
test('service success is visible but cannot override current provider failure or stale data',()=>{
 const d={...current,source:'2026_unit_tracker',device_type:'Sniper'};
 const checks={1:{overall_status:'online',ip_reachable:true,checked_at:current.source_last_seen_at}};
 const g=api.classifyUnit([d],[],now,checks);assert.equal(g.state,'service');assert.equal(g.providerState,'verifying');assert.equal(g.cameraState,'mapping');
 assert.equal(api.classifyUnit([current],[],now,checks).state,'offline');
 assert.equal(api.classifyUnit([d],[],now+21*60000,checks).state,'mapping');
 assert.equal(api.serviceState(d,{1:{...checks[1],ip_reachable:false}},now),'verifying');
});
test('one synthetic244-unit dataset partitions provider systems, service-only evidence and camera coverage',()=>{
 let id=1000;const groups=[],checks={};
 const add=(n,kind,status,service)=>{for(let i=0;i<n;i++){
  const d={...current,id:++id,unit_key:'SYNTHETIC '+id,device_type:kind==='nvr'?'NVR':kind==='port'?'Sniper':'IPC',source:kind==='port'?'2026_unit_tracker':'vigilant_control_center',source_status:status};
  if(service)checks[d.id]={overall_status:service,ip_reachable:service==='online',confirmed_outage:service==='offline',checked_at:current.source_last_seen_at};
  const ds=kind==='mixed'?[{...d,source_status:'online'},{...d,id:++id,source_status:'offline'}]:[d];groups.push({k:d.unit_key,ds});
 }};
 add(82,'camera','online');add(2,'camera','offline');add(3,'mixed','online');add(4,'camera',null);add(57,'nvr','online');add(1,'nvr','offline');add(26,'port',null,'online');add(2,'port',null,'offline');add(5,'port',null);
 for(const [n,status] of [[7,'online'],[27,'offline'],[28,null]])for(let i=0;i<n;i++){const d={...current,id:null,unit_key:'SYNTHETIC '+(++id),__trackerOnly:true,__providerLabel:'Witness',source:'tracker_evidence',source_status:null,__evidence:status?{status,reachable:status==='online',confirmed_outage:status==='offline',checked_at:current.source_last_seen_at}:null};groups.push({k:d.unit_key,ds:[d]})}
 const classified=groups.map(g=>({...g,...api.classifyUnit(g.ds,[],now,checks)}));const counts=api.coverage(classified);
 assert.equal(classified.length,244);assert.equal(counts.online,139);assert.equal(counts.offline,3);assert.equal(counts.review,102);assert.equal(counts.serviceReachable,33);assert.equal(counts.review-counts.serviceReachable,69);assert.equal(counts.online+counts.offline+counts.review,244);
 assert.equal(counts.cameraOnline,82);assert.equal(counts.cameraOffline,2);assert.equal(counts.cameraMixed,7);assert.equal(counts.cameraUnavailable,153);assert.equal(counts.degraded,3);
});

test('Witness service success requires matching positive reachability',()=>{const d={...current,__trackerOnly:true,__providerLabel:'Witness',source:'tracker_evidence',__evidence:{status:'online',checked_at:current.source_last_seen_at,reachable:true}};assert.equal(api.serviceState(d,{},now),'online');for(const reachable of [false,null,undefined])assert.equal(api.serviceState({...d,__evidence:{...d.__evidence,reachable}}, {},now),'verifying')});

test('new backend-protected Owner FIELD placement overrides stale tracker SHOP without changing observed health',()=>{
 const d={id:999,unit_key:'SNIPER 312',organization:'Current job',activation_state:'active',activation_source:'owner_location_override_v2',source_status:'offline'};
 const tracker=[{source_label:'SNIPER 312',tracker_state:'shop'}];assert.equal(api.placement(d,tracker),'field');assert.equal(d.source_status,'offline');assert.equal(api.placement({...d,activation_source:'owner_location_override'},tracker),'unknown');assert.equal(api.placement({...d,organization:'ROOT',activation_state:'deactivated'},tracker),'shop');
});
