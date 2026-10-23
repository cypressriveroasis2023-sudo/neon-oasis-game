import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectVisionFleet} from '../../supabase/functions/onsite-vision-agent/fleetIntelligence.ts';

const js=readFileSync(new URL('../../onsite-vision-fleet-data.js',import.meta.url),'utf8');
const browser=readFileSync(new URL('../../onsite-vision.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../../supabase/functions/onsite-vision-agent/index.ts',import.meta.url),'utf8');
const context=vm.createContext({Date,Intl,console});
vm.runInContext(js,context);
const fleetReader=context.OnSiteVisionFleetData;
const t=new Date(Date.now()-60000).toISOString();

function health(){
  const rows=[
    {id:2,name:'Baytown Camera',unit:'Spotter 046',type:'IPC',scope:'field',activationState:'ACTIVE',
      status:'offline',evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,
        status:'offline',observedAt:t,lastOnlineAt:new Date(Date.now()-3600000).toISOString()}},
    {id:3,name:'Shop Camera',unit:'Spotter 088',type:'IPC',scope:'shop',activationState:'ACTIVE',
      status:'review',evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt:t,lastOnlineAt:t}},
    {id:4,name:'Recorder',unit:'Spotter 046',type:'NVR',scope:'field',activationState:'ACTIVE',
      status:'offline',evidence:{kind:'provider',source:'Star4Live',resource:'recorder',active:true,status:'offline',observedAt:t,lastOnlineAt:t}}
  ];
  return {evidenceVersion:2,refreshedAt:t,rows,totalDevices:3,fieldDevices:2,shopRoot:1,
    online:0,offline:2,review:0,
    inventory:{allRecords:3,activeFieldRecords:2,activeShopRecords:1,inactiveRecords:0,unknownScopeRecords:0}};
}
const map={summary:{fieldUnits:1},items:[{id:'b',unitNumber:'Spotter 46',site:'Yard',customer:'Baytown & Co',address:'100 Main St, Baytown, TX'}]};
function projected(scope='offline'){
  return projectVisionFleet(health(),map,{scope,unit_reference:'',location_query:'',limit:60});
}

test('Camera question parser supports offline, online, unit, and location without an AI model',()=>{
  assert.equal(fleetReader.queryFromText('How many cameras are offline?').scope,'offline');
  assert.equal(fleetReader.queryFromText('Show Star4Live cameras online').scope,'online');
  assert.equal(fleetReader.queryFromText('Where is Spotter 046 located?').unit_reference,'Spotter 046');
  assert.equal(fleetReader.queryFromText('Which cameras are down in Baytown?').location_query,'Baytown');
  assert.equal(fleetReader.queryFromText('How many cameras online and offline?').scope,'summary');
});

test('A verified source result renders separated camera and recorder counts and recorded location',async()=>{
  const calls=[];
  const client={functions:{invoke:async(name,args)=>{
    calls.push({name,args});
    return {data:{ok:true,read_only:true,model_required:false,fleet:projected()},error:null};
  }}};
  const html=await fleetReader.answer('Show me every offline camera and its location',client);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'onsite-vision-agent');
  assert.equal(calls[0].args.body.mode,'fleet_health');
  assert.equal(calls[0].args.body.question.scope,'offline');
  assert.match(html,/Provider camera records/);
  assert.match(html,/NVR recorder records/);
  assert.match(html,/Baytown &amp; Co/);
  assert.match(html,/100 Main St, Baytown/);
  assert.match(html,/Spotter 046 · OFFLINE/);
  assert.match(html,/not proof of uninterrupted downtime|not verified/);
  assert.doesNotMatch(html,/Shop Camera/);
  assert.doesNotMatch(html,/AI is not configured|model credential/);
});

test('Online source selection does not list currently offline rows',()=>{
  const r=projected('online');
  assert.equal(r.items.length,0);
  assert.equal(r.monitored_cameras.offline,1);
  assert.equal(r.monitored_recorders.offline,1);
});

test('HTML escapes remote provider, site and unit values',()=>{
  const r=projected();
  r.items[0].name='<img src=x onerror=alert(1)>';
  r.items[0].unit='<img src=x onerror=alert(1)>';
  r.items[0].location.site='<script>go()</script>';
  const html=fleetReader.render(r,{scope:'offline'});
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;go/);
  assert.match(html,/&lt;img src=x/);
});

test('Read failure or invalid counts never produces invented online/offline totals',async()=>{
  const failed=await fleetReader.answer('How many cameras are offline?',{functions:{invoke:async()=>({error:{message:'OPENAI_API_KEY_MISSING'},data:null})}});
  assert.match(failed,/could not be verified/);
  assert.doesNotMatch(failed,/\b0 cameras offline\b/i);
  const broken=projected();
  broken.monitored_cameras.total=999;
  assert.throws(()=>fleetReader.render(broken,{scope:'offline'}),/inconsistent/);
});

test('Vision client routes camera questions to direct verified read, not OpenAI chat fallback',()=>{
  const begin=browser.indexOf('  if(cameraFleetIntent(raw)){');
  const end=browser.indexOf('\n  const current=chat();',begin);
  assert.ok(begin>0&&end>begin);
  const route=browser.slice(begin,end);
  assert.match(route,/OnSiteVisionFleetData/);
  assert.match(route,/fleet\.answer\(raw,db\)/);
  assert.doesNotMatch(route,/serverAgentAnswer/);
});

test('Server bypasses absent OpenAI key only AFTER active Owner authentication',()=>{
  const guard=server.indexOf("profile.role !== 'owner'");
  const direct=server.indexOf("if (body.mode === 'fleet_health')");
  const missingKey=server.indexOf("if (!apiKey)");
  assert.ok(guard>0&&direct>guard&&missingKey>direct);
  const section=server.slice(direct,missingKey);
  assert.match(section,/readVisionFleetHealth\(token/);
  assert.match(section,/enrichVisionOfflineHistory\(saved, userClient\)/);
  assert.match(section,/read_only: true, model_required: false/);
  assert.doesNotMatch(section,/service_role|\.update\(|\.insert\(|\.delete\(/);
});

test('Multiple distinct provider camera channels on one unit appear as one expandable unit',()=>{
  const rows=[1,2,3,4].map(id=>({
    id,name:'SolarSpotter 029_'+id,unit:'SOLARSPOTTER 029',type:'IPC',
    scope:'field',activationState:'ACTIVE',status:'offline',
    evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,
      status:'offline',observedAt:t,lastOnlineAt:new Date(Date.now()-86400000).toISOString()}
  }));
  const more={...rows[0],id:5,name:'Solar Spotter 029HDC2',unit:'Solar Spotter 029HDC2',
    status:'online',evidence:{...rows[0].evidence,status:'online'}};
  const cameraRows=[...rows,more];
  const result=projectVisionFleet({
    evidenceVersion:2,refreshedAt:t,rows:cameraRows,totalDevices:5,
    fieldDevices:5,shopRoot:0,online:1,offline:4,review:0,
    inventory:{allRecords:5,activeFieldRecords:5,activeShopRecords:0,
      inactiveRecords:0,unknownScopeRecords:0}
  },map,{scope:'summary',unit_reference:'',location_query:'',limit:60});
  assert.equal(result.monitored_cameras.total,5);
  assert.equal(result.monitored_cameras.offline,4);
  const html=fleetReader.render(result,{scope:'summary'});
  assert.equal((html.match(/class="vision-fleet-unit"/g)||[]).length,2);
  assert.match(html,/Solar Spotter 029 · OFFLINE OBSERVATIONS/);
  assert.match(html,/4\/4 cameras OFFLINE/);
  assert.match(html,/SolarSpotter 029_1/);
  assert.match(html,/SolarSpotter 029_2/);
  assert.match(html,/SolarSpotter 029_3/);
  assert.match(html,/SolarSpotter 029_4/);
  assert.match(html,/Solar Spotter 029HDC2/);
  assert.match(html,/Source record 1/);
  assert.match(html,/Verified equipment, but recorded COS service address is unavailable/);
  assert.doesNotMatch(html,/4 units offline/i);
});
