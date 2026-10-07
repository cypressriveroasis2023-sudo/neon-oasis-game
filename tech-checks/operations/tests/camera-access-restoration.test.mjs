import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cameraFamily,cameraResourcePath,cameraUnitStatusLabel,cameraOverview} from '../src/cameraHealthCounts.ts';
import {resource,port,snapshot,now} from './fixtures/camera-evidence-fixtures.mjs';
const list=readFileSync(new URL('../../camera-health.html',import.meta.url),'utf8');
const helper=readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8');
const context=vm.createContext({Intl,cameraGroup:d=>d.family});vm.runInContext(helper,context);
const start=list.indexOf('function fleetMatches(');vm.runInContext(list.slice(start,list.indexOf('\n',start)),context);
const {connections}=context.CameraHealthHistory;

test('Avigilon, Sniper and CAM V filters use service observations without changing provider status',()=>{
 for(const family of ['Sniper','CAM V'])for(const serviceState of ['online','offline','verifying','degraded']){
  const g={state:serviceState==='online'?'service':'mapping',providerState:'verifying',serviceState,ds:[{family}]};
  const prefix=family==='Sniper'?'Sniper':'CamV';
  for(const candidate of [prefix,'Avigilon']){
   assert.equal(context.fleetMatches(g,candidate+'Online'),serviceState==='online');
   assert.equal(context.fleetMatches(g,candidate+'Offline'),serviceState==='offline');
  }
  assert.equal(context.fleetMatches(g,family),true);assert.equal(context.fleetMatches(g,'Avigilon'),true);
  assert.equal(context.fleetMatches(g,'Online'),false);assert.equal(context.fleetMatches(g,'Offline'),false);
 }
 for(const label of ['Snipers','CAM V','Avigilon units']){
  assert.ok(list.includes(label+' · Service reachable'));assert.ok(list.includes(label+' · Service check failed'));
 }
});

test('native family selection retains reachable, failed and unknown unit cards without inventing camera health',()=>{
 for(const family of ['SNIPER 2','SNIPER 4','CAM V','CAMV','CAM-V']){
  const rows=['online','offline','unknown'].map((status,index)=>resource(index+1,family+' 0'+(index+1),{type:family,evidence:undefined,serviceEvidence:port({status,reachable:status==='online',confirmedOutage:status==='offline'})}));
  const overview=cameraOverview(snapshot(rows),now);
  assert.equal(overview.groups.length,3);assert.equal(overview.summary.online,0);assert.equal(overview.summary.offline,0);
  assert.equal(overview.groups.filter(group=>cameraFamily(group.rows,family.startsWith('SNIPER')?'sniper':'camv')).length,3);
  assert.deepEqual(overview.groups.map(g=>g.serviceState).sort(),['offline','online','verifying']);
  for(const group of overview.groups){assert.equal(group.cameraState,'mapping');assert.equal(cameraUnitStatusLabel(group),'IP / PORT '+({online:'ONLINE',offline:'OFFLINE',verifying:'UNVERIFIED'}[group.serviceState]));}
 }
});

test('saved endpoints survive failed, stale and missing checks; Unity ports are not guessed HTTP',()=>{
 const device={expected_ports:[80,443,8443,38880,38881],port_labels:{38880:'Unity client',38881:'Unity service'}};
 for(const health of [{},{checked_at:'bad',port_status:{}},{checked_at:'2020-01-01T00:00:00Z',port_status:{443:{online:true}}},{port_status:{80:{online:false},443:{online:false},38880:{online:false},38881:{online:false}}}]){
  const targets=connections(device,health,'192.0.2.20/32');
  assert.equal(targets.length,6);
  assert.equal(targets.find(t=>t.port===443).url,'https://192.0.2.20');
  assert.equal(targets.find(t=>t.port===8443).url,'https://192.0.2.20:8443');
  for(const p of [38880,38881]){assert.equal(targets.find(t=>t.port===p).url,null);assert.equal(targets.find(t=>t.port===p).address,'192.0.2.20:'+p);}
  assert.equal(targets.some(t=>t.port===38884),false);
 }
 assert.equal(connections({expected_ports:[38884]}, {},'192.0.2.20').find(t=>t.port===38884).url,null);
 assert.equal(connections({}, {port_status:{8443:{online:false}}},'192.0.2.20').find(t=>t.port===8443).url,'https://192.0.2.20:8443');
});

test('connection destinations reject malformed IPs and ports, and diagnostics never guess tracker IDs',()=>{
 for(const ip of ['',null,'https://192.0.2.1','192.0.2.1@evil.test','192.0.2.999','192.0.2.1/24','192.0.2.020','192.0.2.008','0192.0.2.1','javascript:alert(1)'])assert.equal(connections({}, {},ip).length,0);
 assert.equal(connections({expected_ports:[null,0,-1,65536,'443/path','443@host',{},false]}, {},'192.0.2.1').length,1);
 assert.equal(cameraResourcePath(resource(127,'SNIPER 2 005')),'../../camera-detail.html?id=127');
 for(const id of [null,0,-1,'tracker:camv|001','1?next=evil','1/../../other',1.2,Number.MAX_SAFE_INTEGER+1])assert.equal(cameraResourcePath({...resource(id)}),null);
 assert.equal(cameraResourcePath({...resource(1),trackerOnly:true}),null);
});
