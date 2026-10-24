import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fieldCameraHealth,cameraTime} from '../src/fieldCameraHealth.ts';
import {cameraOverview,cameraUnitDisplayState} from '../src/cameraHealthCounts.ts';
import {classifyCameraUnit} from '../src/cameraEvidence.ts';
import {linkedUnitObservation} from '../src/verifiedUnitIdentity.ts';
import {savedConnectionObservation} from '../src/savedConnectionObservation.ts';
import {healthObservationTime,healthObservationLabel} from '../src/healthObservationTime.ts';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import FleetUnitHealth from '../src/FleetUnitHealth.tsx';
import CameraHealthOverview,{CameraResourceObservations} from '../src/CameraHealthOverview.tsx';
import {resource,port,snapshot,withStatus} from './fixtures/camera-evidence-fixtures.mjs';

const now=Date.parse('2026-10-14T16:00:00Z');
const cameraAt='2026-10-14T15:45:00Z',portAt='2026-10-14T15:59:00Z',staleAt='2026-10-14T15:00:00Z';
const iso=value=>value?new Date(value).toISOString():null;
const unit={id:'11111111-1111-4111-8111-111111111111',unitNumber:'Helios 1',modelName:'Helios',status:'field',currentLocationType:'field'};
const camera=(id=1,status='online',at=cameraAt,options={})=>withStatus(resource(id,unit.unitNumber,options),status,at);
const service=(options={})=>port({observedAt:portAt,...options});
const health=rows=>({...snapshot(rows),refreshedAt:new Date(now).toISOString()});
const field=(rows,u=unit,h=health(rows))=>fieldCameraHealth(u,[u],h,now);
const overview=(rows,units=[unit],h=health(rows))=>cameraOverview(h,now,units);
const verified=(rows,u=unit,kind='native_provider')=>({...health(rows),identityVersion:1,unitIdentities:[{unitId:u.id,unitNumber:u.unitNumber,kind,deviceIds:rows.map(row=>String(row.id)),unitKeys:[...new Set(rows.map(row=>row.unit))],proof:'a'.repeat(64)}]});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

for(const status of ['online','offline'])test(`${status} camera time cannot be renewed by a newer service-port observation`,()=>{
  const rows=[camera(1,status,cameraAt,{serviceEvidence:service()})],before=structuredClone(rows),value=field(rows),view=overview(rows);
  assert.equal(value.state,'unknown');assert.equal(value.identity,'missing');assert.equal(value.checkedAt,null);assert.equal(healthObservationTime(rows,'camera',status,now),iso(cameraAt));
  assert.equal(value.classification,null);assert.equal(classifyCameraUnit(rows,now).providerState,status);assert.equal(classifyCameraUnit(rows,now).serviceState,'online');
  assert.equal(view.groups[0].lastObservedAt,iso(cameraAt));assert.equal(cameraUnitDisplayState(view.groups[0]),'verifying');assert.equal(view.groups[0].linkedIdentity,false);
  assert.equal(view.groups[0].lastObservedLabel,`Latest ${status} camera/detector record observation`);
  assert.deepEqual(view.operational,{monitored:0,online:0,offline:0,unknown:1});
  assert.deepEqual(view.cameras,{total:1,online:status==='online'?1:0,offline:status==='offline'?1:0,unknown:0});
  assert.deepEqual(rows,before);
});

test('an offline witness keeps its own time beside a newer online camera and port',()=>{
  const outageAt='2026-10-14T15:41:00Z',onlineAt='2026-10-14T15:58:00Z';
  const rows=[camera(1,'offline',outageAt,{serviceEvidence:service()}),camera(2,'online',onlineAt)];
  const value=field(rows),shared=overview(rows),unlinked=overview(rows,[]);
  assert.equal(value.state,'unknown');assert.equal(value.checkedAt,null);assert.equal(classifyCameraUnit(rows,now).cameraState,'degraded');assert.equal(healthObservationTime(rows,'camera','offline',now),iso(outageAt));
  assert.equal(shared.groups[0].lastObservedAt,iso(onlineAt));assert.equal(shared.groups[0].lastObservedLabel,'Latest camera/detector record observation');
  assert.equal(cameraUnitDisplayState(unlinked.groups[0]),'verifying');assert.equal(unlinked.groups[0].lastObservedAt,iso(onlineAt));
  assert.equal(unlinked.groups[0].lastObservedLabel,'Latest camera/detector record observation');
  assert.deepEqual(shared.summary,unlinked.summary);assert.deepEqual(shared.cameras,{total:2,online:1,offline:1,unknown:0});
});

test('recorders and inactive cameras cannot donate a fallback camera observation time',()=>{
  const rows=[camera(),camera(2,'offline',portAt,{type:'NVR'}),camera(3,'offline',portAt,{scope:'inactive'})];
  const value=field(rows),view=overview(rows);
  assert.equal(value.state,'unknown');assert.equal(value.checkedAt,null);assert.equal(classifyCameraUnit(rows,now).recorderOffline,true);
  assert.equal(classifyCameraUnit(rows,now).providerState,'degraded');assert.equal(view.groups[0].lastObservedAt,iso(portAt));assert.equal(healthObservationTime(rows,'camera','online',now),iso(cameraAt));
  assert.deepEqual(view.kinds,{cameras:2,detectors:0,recorders:1,unitInventory:0,other:0});
  assert.deepEqual(view.cameras,{total:1,online:1,offline:0,unknown:0});
  assert.equal(field([rows[1]]).checkedAt,null);
});

for(const [name,at,expected] of [['stale',staleAt,iso(staleAt)],['missing',null,null],['invalid','bad',null],['future','2026-10-14T16:01:00Z',null]])test(`${name} camera evidence stays unverified without borrowing the fresh port time`,()=>{
  const rows=[camera(1,'online',at,{serviceEvidence:service()})],value=field(rows),view=overview(rows);
  assert.equal(value.state,'unknown');assert.equal(value.basis,undefined);assert.equal(value.checkedAt,null);
  assert.equal(classifyCameraUnit(rows,now).cameraState,'verifying');assert.equal(classifyCameraUnit(rows,now).serviceState,'online');assert.equal(healthObservationTime(rows,'camera','verifying',now),expected);
  assert.equal(cameraUnitDisplayState(view.groups[0]),'verifying');assert.equal(view.groups[0].linkedIdentity,false);
  assert.deepEqual(view.cameras,{total:1,online:0,offline:0,unknown:1});
  assert.equal(value.rows[0].evidence.observedAt,at);
});

test('unaccepted source kind, activation, resource and provider do not supply a camera display time',()=>{
  const base=camera();
  for(const row of [{...base,evidence:{...base.evidence,kind:'unknown'}},{...base,evidence:{...base.evidence,source:'Unverified source'}},{...base,evidence:{...base.evidence,resource:'recorder'}},{...base,evidence:{...base.evidence,active:false}},{...base,activationState:'deactivated'},{...base,trackerOnly:true}]){
    const value=field([{...row,serviceEvidence:service()}]);assert.equal(value.state,'unknown');assert.equal(value.checkedAt,null);
  }
  for(const evidenceVersion of [undefined,1]){
    const rows=[{...base,serviceEvidence:service()}],value=field(rows,unit,{...health(rows),evidenceVersion});
    assert.equal(value.state,'unknown');assert.equal(value.checkedAt,null);assert.equal(overview(rows,[unit],{...health(rows),evidenceVersion}).groups[0].lastObservedAt,null);
  }
});

for(const embedded of [false,true])for(const status of ['online','offline'])test(`${embedded?'embedded':'separate'} ${status} port evidence supplies its actual connection time`,()=>{
  const direct={...unit,unitNumber:'Sniper 1',modelName:'Sniper'},evidence=service({status,reachable:status==='online',confirmedOutage:status==='offline'});
  const row=resource(1,direct.unitNumber,{type:'Sniper',...(embedded?{evidence}:{serviceEvidence:evidence})}),value=field([row],direct),group=overview([row],[direct]).groups[0];
  assert.equal(savedConnectionObservation(row,now),status);assert.equal(value.state,'unknown');assert.equal(value.basis,undefined);assert.equal(value.checkedAt,null);assert.equal(healthObservationTime([row],'connection',status,now),iso(portAt));
  assert.equal(group.lastObservedAt,iso(portAt));assert.equal(group.lastObservedLabel,`Latest ${status} IP / port record observation`);
  assert.equal(linkedUnitObservation([row],now).checkedAt,iso(portAt));
});

test('connection timestamps preserve stale time and exact source precedence without accepting a fallback result',()=>{
  const direct={...unit,unitNumber:'Sniper 1',modelName:'Sniper'};
  for(const [at,expected] of [[staleAt,iso(staleAt)],[null,null],['bad',null],['2026-10-14T16:01:00Z',null]]){
    const row=resource(1,direct.unitNumber,{type:'Sniper',evidence:service({observedAt:at})}),value=field([row],direct);
    assert.equal(value.state,'unknown');assert.equal(value.checkedAt,null);assert.equal(linkedUnitObservation([row],now).checkedAt,expected);
  }
  const row=resource(1,direct.unitNumber,{type:'Sniper',evidence:service(),serviceEvidence:service({observedAt:null,status:'unknown'})});
  assert.equal(savedConnectionObservation(row,now),'verifying');assert.equal(field([row],direct).checkedAt,null);assert.equal(linkedUnitObservation([row],now).checkedAt,null);
});

test('durable camera identity and overview preserve provider time instead of newer port time',()=>{
  for(const status of ['online','offline']){
    const rows=[camera(1,status,cameraAt,{serviceEvidence:service()})],h=verified(rows),value=field(rows,unit,h),group=overview(rows,[],h).groups[0];
    assert.equal(value.state,status);assert.equal(value.basis,'camera');assert.equal(value.checkedAt,iso(cameraAt));assert.equal(group.lastObservedAt,value.checkedAt);
    assert.equal(group.observation.checkedAt,value.checkedAt);assert.equal(group.providerState,status);assert.equal(group.serviceState,'online');
  }
});

test('durable stale-provider fallback reports its accepted connection basis, and stale sources do not renew it',()=>{
  const rows=[camera(1,'online',staleAt,{serviceEvidence:service()})],h=verified(rows),value=field(rows,unit,h);
  assert.equal(value.basis,'connection');assert.equal(value.state,'online');assert.equal(value.checkedAt,iso(portAt));assert.equal(overview(rows,[],h).groups[0].lastObservedAt,iso(portAt));
  const stale=[camera(1,'online',staleAt,{serviceEvidence:service({observedAt:staleAt})})],staleHealth=verified(stale),unknown=field(stale,unit,staleHealth);
  assert.equal(unknown.basis,'camera');assert.equal(unknown.state,'unknown');assert.equal(unknown.checkedAt,iso(staleAt));
});

test('verified recorder observations retain placement-independent source time',()=>{
  for(const scope of ['shop','inactive']){
    const rows=[camera(1,'online',cameraAt,{type:'NVR',scope,serviceEvidence:service()})],h=verified(rows),value=field(rows,unit,h);
    assert.equal(value.state,'online');assert.equal(value.basis,'recorder');assert.equal(value.checkedAt,iso(cameraAt));assert.match(value.reason,/PLACEMENT CONFLICT/);
    assert.equal(overview(rows,[],h).groups[0].lastObservedAt,iso(cameraAt));
  }
});

test('verified embedded service-port and identity-conflict timestamps remain honest',()=>{
  const direct={...unit,unitNumber:'Sniper 1',modelName:'Sniper'},rows=[resource(1,direct.unitNumber,{type:'Sniper',evidence:service()})];
  const identity={unitId:direct.id,unitNumber:direct.unitNumber,kind:'owner_confirmed_native',deviceIds:['1'],unitKeys:[direct.unitNumber],proof:'a'.repeat(64)};
  const h={...health(rows),identityVersion:1,unitIdentities:[],ownerConfirmedIdentityVersion:1,ownerConfirmedUnitIdentities:[identity]};
  assert.equal(field(rows,direct,h).checkedAt,iso(portAt));assert.equal(overview(rows,[direct],h).groups[0].lastObservedAt,iso(portAt));
  const conflict={...h,identityWarnings:[{unitId:direct.id,deviceIds:['1'],unitKeys:[direct.unitNumber],reason:'Synthetic identity conflict'}]};
  assert.equal(field(rows,direct,conflict).checkedAt,null);const group=overview(rows,[direct],conflict).groups[0];
  assert.equal(group.lastObservedAt,null);assert.equal(cameraUnitDisplayState(group),'verifying');
});

test('rendered unit and overview cards label the correct record time while raw port history stays separate',()=>{
  const rows=[camera(1,'offline',cameraAt,{serviceEvidence:service()})],h=verified(rows),row=fleetDashboardRows([unit],h,[],null,now)[0];
  const card=render(FleetUnitHealth,{row,now}),grid=render(CameraHealthOverview,{health:h,now,units:[unit]});
  for(const html of [card,grid])assert.ok(html.includes('Latest offline camera/detector record observation: '+cameraTime(cameraAt,now)));
  const cameraSection=card.split('aria-label="Selected unit camera health"')[1].split('</section>')[0];assert.ok(!cameraSection.includes(cameraTime(portAt,now)));
  const raw=render(CameraResourceObservations,{rows,now});assert.ok(raw.includes(cameraTime(cameraAt,now)));assert.ok(raw.includes(cameraTime(portAt,now)));assert.match(raw,/Last reported service result: ONLINE/);
  const unknownRows=[camera(1,'online',null,{serviceEvidence:service()})],unknown=fleetDashboardRows([unit],health(unknownRows),[],null,now)[0];
  assert.equal(unknown.camera.identity,'missing');assert.equal(unknown.camera.checkedAt,null);assert.match(render(FleetUnitHealth,{row:unknown,now}),/UNVERIFIED|unverified/i);
});

test('display selector and labels never claim a common group observation or change freshness boundaries',()=>{
  assert.equal(healthObservationLabel('camera','offline'),'Latest offline camera/detector record observation');
  assert.equal(healthObservationLabel('provider','degraded'),'Latest provider record observation');
  const boundary='2026-10-14T15:40:00Z',rows=[camera(1,'online',boundary)];
  assert.equal(field(rows,unit,verified(rows)).state,'online');assert.equal(field(rows,unit,verified(rows)).checkedAt,iso(boundary));
  const after=fieldCameraHealth(unit,[unit],verified(rows),now+1);assert.equal(after.state,'unknown');assert.equal(after.checkedAt,iso(boundary));
  assert.equal(healthObservationTime([camera(1,'online',cameraAt),camera(2,'online',portAt)],'camera','online',now),iso(portAt));
});
