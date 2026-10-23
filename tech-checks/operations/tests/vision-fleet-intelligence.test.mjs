import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectVisionFleet,readVisionFleetHealth} from '../../supabase/functions/onsite-vision-agent/fleetIntelligence.ts';

const NOW=Date.parse('2026-10-23T15:00:00Z');
const stamp=(minutes=1)=>new Date(NOW-minutes*60000).toISOString();
const question=(values={})=>({scope:'summary',unit_reference:'',location_query:'',limit:30,...values});
const provider=(state,values={})=>({
  kind:'provider',source:'Star4Live',resource:'camera',active:true,status:state,
  observedAt:stamp(),lastOnlineAt:stamp(150),...values,
});
const row=(id,unit,state,values={})=>({
  id,name:'Camera '+id,unit,type:'ipc',scope:'field',activationState:'ACTIVE',
  status:state==='online'||state==='offline'?state:'review',
  evidence:provider(state),...values,
});
const snapshot=(rows,generated=stamp())=>{
  const counts={field:0,shop:0,inactive:0,unknown:0};
  const statuses={online:0,offline:0,review:0};
  for(const r of rows){counts[r.scope]++;if(r.scope==='field')statuses[r.status]++;}
  return {evidenceVersion:2,refreshedAt:generated,rows,totalDevices:rows.length,
    fieldDevices:counts.field,shopRoot:counts.shop,...statuses,
    inventory:{allRecords:rows.length,activeFieldRecords:counts.field,
      activeShopRecords:counts.shop,inactiveRecords:counts.inactive,unknownScopeRecords:counts.unknown}};
};
const fieldMap={summary:{fieldUnits:2},items:[
  {id:'u1',unitNumber:'Helios 7',customer:'Acuity',site:'Baytown yard',address:'101 Main St, Baytown, TX'},
  {id:'u2',unitNumber:'Spotter 46',customer:'Other',site:'Katy site',address:'456 Second St, Katy, TX'},
]};

test('Provider counts are source records, not equipment or physical video channels',()=>{
  const rows=[
    row(1,'Helios 007','online'),
    row(2,'Spotter 046','offline'),
    row(3,'Spotter 100','offline',{scope:'shop'}),
    row(4,'Spotter 200','online',{scope:'unknown'}),
  ];
  const data=projectVisionFleet(snapshot(rows),fieldMap,question({scope:'offline'}),NOW);
  assert.deepEqual(data.monitored_cameras,{total:2,online:1,offline:1,unverified:0});
  assert.equal(data.shop_resources_excluded,1);
  assert.equal(data.unknown_scope_resources,1);
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].unit,'Spotter 046');
  assert.equal(data.items[0].location.site,'Katy site');
  assert.equal(data.items[0].outage_started_at,null);
  assert.match(data.items[0].outage_duration,/NOT RECORDED/);
});
test('Stale, incomplete or untrusted provider status becomes unverified, never offline',()=>{
  const rows=[
    row(1,'Helios 007','offline',{evidence:provider('offline',{observedAt:stamp(21)})}),
    row(2,'Spotter 046','offline',{evidence:provider('offline',{source:'Unknown'})}),
    row(3,'Spotter 056','offline',{activationState:'DEACTIVATED'}),
  ];
  const data=projectVisionFleet(snapshot(rows),fieldMap,question({scope:'attention'}),NOW);
  assert.equal(data.monitored_cameras.offline,0);
  assert.equal(data.monitored_cameras.unverified,3);
  assert.equal(data.items.every(x=>x.status==='unverified'),true);
  assert.equal(data.field_resource_census.offline,3); // raw source census, clearly distinguished.
});
test('Direct service ports never inflate camera-online or camera-offline counts',()=>{
  const port={kind:'service_port',source:'Direct service-port check',active:true,
    status:'offline',observedAt:stamp(),reachable:false,confirmedOutage:true,lastOnlineAt:stamp(120)};
  const rows=[
    row(1,'CAM V 014','review',{type:'camv',serviceEvidence:port,evidence:undefined}),
    row(2,'Sniper 2 039','review',{type:'sniper 2',serviceEvidence:port,evidence:undefined}),
  ];
  const data=projectVisionFleet(snapshot(rows),fieldMap,question({scope:'offline'}),NOW);
  assert.equal(data.monitored_cameras.total,0);
  assert.equal(data.service_port_checks.offline,2);
  assert.equal(data.service_items.length,2);
  assert.equal(data.service_items.every(x=>x.kind.includes('IP/port')),true);
});
test('Unverified or missing locations never manufacture a current address',()=>{
  const rows=[row(1,'Helios 007','offline')];
  const noMap=projectVisionFleet(snapshot(rows),null,question({scope:'location',location_query:'baytown'}),NOW);
  assert.equal(noMap.location_filter_unverifiable,true);
  assert.equal(noMap.items.length,0);
  const duplicate={summary:{fieldUnits:3},items:[...fieldMap.items,{id:'u3',unitNumber:'Helios 007',customer:'Other',site:'Different'}]};
  const ambiguous=projectVisionFleet(snapshot(rows),duplicate,question(),NOW);
  assert.equal(ambiguous.items[0].location,null);
  assert.equal(ambiguous.unmatched_field_resource_locations,1);
});
test('Fails closed on incomplete, duplicate or inconsistent Camera Health',()=>{
  const h=snapshot([row(1,'Helios 007','online')]);
  assert.throws(()=>projectVisionFleet({...h,fieldDevices:999},fieldMap,question(),NOW),/census/);
  assert.throws(()=>projectVisionFleet({...h,rows:[h.rows[0],h.rows[0]],totalDevices:2,
      fieldDevices:2,online:2,inventory:{...h.inventory,allRecords:2,activeFieldRecords:2}},fieldMap,question(),NOW),/identity/);
  assert.throws(()=>projectVisionFleet(null,fieldMap,question(),NOW),/unavailable/);
});
test('Owner agent only performs authorized, read-only saved Health and Map GET envelopes',async()=>{
  const requests=[];
  const health=snapshot([row(1,'Helios 007','offline')],new Date().toISOString());
  const fetcher=async(url,options)=>{
    requests.push({url,options});
    const {path,method,body}=JSON.parse(options.body);
    assert.equal(method,'GET');
    assert.equal(body,null);
    assert.ok(['/api/camera-health/summary-v3','/api/field-map'].includes(path));
    assert.equal(options.headers.Authorization,'Bearer verified-owner-session');
    return {ok:true,json:async()=>path.endsWith('summary-v3')?health:fieldMap};
  };
  const data=await readVisionFleetHealth('verified-owner-session',question({scope:'summary'}),fetcher);
  assert.equal(requests.length,2);
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].location.customer,'Acuity');
});

test('Vision routes camera fleet questions to the source tool, not the separate offline-case queue',()=>{
  const source=readFileSync(new URL('../../onsite-vision.js',import.meta.url),'utf8');
  const start=source.indexOf('function cameraFleetIntent(');
  const end=source.indexOf('\nasync function answer(',start);
  assert.ok(start>0&&end>start);
  const cameraFleetIntent=vm.runInNewContext(source.slice(start,end)+'\ncameraFleetIntent');
  for(const message of [
    'How many cameras are offline right now?',
    'Which cameras have been down for 24 hours?',
    'Where is Spotter 046 located?',
    'Is Sniper 2 039 offline?',
    'Show me Star4Live cameras online in Baytown.',
    'Show me the Avigilon camera health.'
  ])assert.equal(cameraFleetIntent(message),true,message);
  for(const message of [
    'How many offline escalations are waiting on IT?',
    'What troubleshooting has already been done on offline case 12?',
    'Show me active Tech Check jobs.',
    'What is Josh working on?',
  ])assert.equal(cameraFleetIntent(message),false,message);
});
