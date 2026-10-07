import test from 'node:test';import assert from 'node:assert/strict';
import {cameraOverview,resourceKind} from '../src/cameraHealthCounts.ts';
import {classifyCameraUnit,cameraEvidenceLabel,unitEvidenceLabel} from '../src/cameraEvidence.ts';
import {validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {resource,port,snapshot,withStatus,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
test('all inventory scopes reconcile without silently dropping location-review groups',()=>{
 const rows=[resource(1),resource(2,'Helios 2',{scope:'unknown'}),resource(3,'Helios 3',{scope:'shop'}),resource(4,'Helios 4',{scope:'inactive',activationState:'deactivated'})];
 const health=snapshot(rows),overview=cameraOverview(health,now);assert.equal(validateCameraHealth(health),health);assert.equal(overview.scopeVerified,true);assert.equal(overview.groups.length,4);assert.equal(overview.summary.monitored,2);assert.deepEqual(overview.scopes,{field:1,unknown:1,shop:1,inactive:1});assert.equal(overview.groups.find(g=>g.key==='HELIOS 2').scope,'unknown');
});
test('NVR-only online and offline are useful recorder observations with no camera channels',()=>{
 for(const status of ['online','offline']){const overview=cameraOverview(snapshot([withStatus(resource(1,'Helios 1',{type:'NVR'}),status)]),now),group=overview.groups[0];assert.equal(group.providerState,status);assert.equal(group.cameraState,'mapping');assert.equal(group.systemKind,'recorder');assert.equal(overview.cameras.total,0);assert.equal(overview.summary[status],1);assert.equal(unitEvidenceLabel(group),'RECORDER '+status.toUpperCase());assert.equal(cameraEvidenceLabel(group.cameraState),'Camera channel status unavailable');}
});
test('detectors are camera evidence, separate from IPC totals, and mixed observations stay review',()=>{
 const rows=[resource(1,'RII-001',{type:'detector'}),withStatus(resource(2,'RII-001',{type:'Reconeyez detector'}),'offline')],overview=cameraOverview(snapshot(rows),now);
 assert.equal(overview.kinds.detectors,2);assert.equal(overview.cameras.total,0);assert.equal(overview.groups[0].cameraState,'degraded');assert.equal(overview.groups[0].systemKind,'detector');assert.deepEqual(overview.summary,{monitored:1,online:0,offline:0,unknown:1});assert.equal(overview.coverage.degraded,1);
});
test('mixed camera/recorder provider status cannot collapse into an all-offline unit',()=>{
 const rows=[resource(1),withStatus(resource(2,'Helios 1',{type:'NVR'}),'offline'),resource(3,'Helios 2')],overview=cameraOverview(snapshot(rows),now);
 assert.equal(overview.groups[0].providerState,'degraded');assert.equal(overview.groups[0].cameraState,'online');assert.equal(overview.groups[0].recorderOffline,true);assert.deepEqual(overview.summary,{monitored:2,online:1,offline:0,unknown:1});assert.deepEqual(overview.cameras,{total:2,online:2,offline:0,unknown:0});
});
test('port-only and tracker-only successes remain service-reachable without provider evidence',()=>{
 const rows=[resource(1,'Sniper 1',{type:'Sniper',serviceEvidence:port()}),resource('tracker:spotter|002','Spotter 2',{type:'tracker_unit',trackerOnly:true,scope:'unknown',evidence:undefined,serviceEvidence:port({source:'Witness service-port check'})})];
 const overview=cameraOverview(snapshot(rows),now);assert.equal(overview.summary.online,0);assert.equal(overview.coverage.serviceReachable,2);assert.equal(overview.coverage.cameraUnavailable,2);for(const group of overview.groups){assert.equal(group.state,'service');assert.equal(unitEvidenceLabel(group),'SERVICE REACHABLE');assert.equal(group.providerState,'verifying');}
});
test('service failures and reachable ports cannot supply or override provider camera evidence',()=>{
 const row=withStatus(resource(1),'offline');let group=classifyCameraUnit([{...row,serviceEvidence:port()}],now);assert.equal(group.providerState,'offline');assert.equal(group.cameraState,'offline');assert.equal(group.serviceState,'online');
 group=classifyCameraUnit([resource(2,'Sniper 2',{type:'Sniper',serviceEvidence:port({status:'offline',reachable:false,confirmedOutage:true})})],now);assert.equal(group.providerState,'verifying');assert.equal(group.cameraState,'mapping');assert.equal(group.serviceState,'offline');assert.notEqual(group.state,'offline');
});
test('older Recon state is retained while presentation recentness never infers an outage',()=>{
 for(const observedAt of [null,'bad','2026-10-06T16:00:00Z','2027-01-01T00:00:00Z']){const row=withStatus(resource(1,'RII-001',{type:'detector'}),'online',observedAt),overview=cameraOverview(snapshot([row]),now);assert.equal(overview.summary.online,0);assert.equal(overview.summary.offline,0);assert.equal(overview.groups[0].rows[0].evidence.status,'online');assert.equal(overview.groups[0].rows[0].evidence.observedAt,observedAt);}
});
test('partial known rows keep mixed status; expected channel counts are never fabricated',()=>{
 const overview=cameraOverview(snapshot([resource(1),withStatus(resource(2),'unknown')]),now);assert.equal(overview.summary.online,0);assert.equal(overview.coverage.cameraMixed,1);
 const known=cameraOverview(snapshot([resource(1)]),now);assert.equal(known.cameras.total,1);assert.equal(Object.hasOwn(known.groups[0],'expectedChannels'),false);assert.match(cameraEvidenceLabel(known.groups[0].cameraState),/^Reported/);
});
test('missing channel evidence does not remove exact saved unit identity',()=>{
 const overview=cameraOverview(snapshot([resource(1,'Helios 8',{type:'NVR'})]),now);assert.equal(overview.summary.monitored,1);assert.equal(overview.unlinked,0);assert.equal(overview.groups[0].linkedIdentity,true);assert.equal(overview.groups[0].name,'Helios 8');
});
test('source mismatches and inventory records can never supply provider camera evidence',()=>{
 for(const type of ['AIBOX','Sniper','ip camera','router']){const row=resource(1,'Helios 1',{type,evidence:resource(1).evidence});assert.equal(classifyCameraUnit([row],now).providerState,'verifying');assert.equal(resourceKind(row)==='cameras',false);}
 const row=resource(1);assert.equal(classifyCameraUnit([{...row,evidence:{...row.evidence,source:'Direct service-port check'}}],now).cameraState,'verifying');
});
test('duplicates, malformed evidence and invalid inventory cannot certify the snapshot',()=>{
 const row=resource(1);for(const rows of [[row,row],[row,{...row,id:'1',unit:'Different'}]]){assert.throws(()=>validateCameraHealth(snapshot(rows)),/duplicate/);assert.equal(cameraOverview(snapshot(rows),now).scopeVerified,false);}
 for(const change of [{scope:'nonsense'},{scope:'field',activationState:''},{evidence:{...row.evidence,reachable:'true'}}])assert.throws(()=>validateCameraHealth(snapshot([{...row,...change}])));
 const wrong=snapshot([row]);wrong.inventory.activeFieldRecords=0;assert.throws(()=>validateCameraHealth(wrong),/reconciled/);
});
test('old API versions fail safely, even when old provider fields claim all online',()=>{
 for(const evidenceVersion of [undefined,1]){const health={...snapshot([resource(1)]),evidenceVersion};const overview=cameraOverview(health,now);assert.equal(overview.scopeVerified,false);assert.equal(overview.summary.online,0);assert.equal(overview.summary.offline,0);assert.equal(overview.groups[0].scope,'unknown');}
});
