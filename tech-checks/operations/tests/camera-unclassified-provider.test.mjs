import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CameraResourceObservations} from '../src/CameraHealthOverview.tsx';
import {unclassifiedProviderReport,providerState,cameraState,cameraTimestamp,observationAge} from '../src/cameraEvidence.ts';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {cameraTime} from '../src/fieldCameraHealth.ts';
import {resource,port,snapshot,withStatus,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';

const unclassified=(changes={})=>withStatus(resource(901,'Helios 8701',{type:'Unknown',name:'Synthetic unclassified resource',...changes}),'offline');
const render=(row,trusted=true,at=now)=>renderToStaticMarkup(React.createElement(CameraResourceObservations,{rows:[row],now:at,trusted}));

test('known-source unclassified reports are historical resources, not typed camera or system health',()=>{
 for(const source of ['Star4Live','Reconeyez'])for(const status of ['online','offline','degraded','unknown']){
  const base=unclassified(),row={...base,evidence:{...base.evidence,source,status}};
  assert.equal(unclassifiedProviderReport(row),row.evidence);
  const html=render(row);
  assert.match(html,new RegExp(source+' resource last reported <b>'+status.toUpperCase()+'</b> at '));
  assert.ok(html.includes(cameraTime(fresh,now)));
  assert.match(html,/Hardware type and camera\/channel status remain unverified/);
  assert.match(html,/saved report does not verify live video/);
  assert.match(html,/PROVIDER NOT VERIFIED/);
  assert.equal(providerState(row,now),'verifying');assert.equal(cameraState(row,now),'verifying');
  const overview=cameraOverview(snapshot([row]),now);
  assert.deepEqual(overview.summary,{monitored:1,online:0,offline:0,unknown:1});
  assert.deepEqual(overview.cameras,{total:0,online:0,offline:0,unknown:0});
  assert.equal(overview.kinds.other,1);assert.equal(overview.groups[0].cameraState,'mapping');
 }
});

test('expired, missing, malformed and future report times never become current evidence',()=>{
 for(const observedAt of ['2026-10-06T16:00:00Z',null,'bad','2026-02-30T17:55:00Z','2026-10-06T18:01:00Z']){
  const row=unclassified();row.evidence.observedAt=observedAt;row.evidence.lastOnlineAt=observedAt;
  const html=render(row);assert.match(html,/Star4Live resource last reported <b>OFFLINE<\/b> at /);
  assert.ok(html.includes(cameraTime(observedAt,now)));assert.ok(html.includes(observationAge(observedAt,now)));
  assert.equal(cameraTimestamp(observedAt,now).fresh,false);
  assert.doesNotMatch(html,/within 15-minute presentation window/);
  assert.equal(providerState(row,now),'verifying');assert.equal(cameraState(row,now),'verifying');
  assert.equal(cameraOverview(snapshot([row]),now).summary.offline,0);
 }
 const row=unclassified();assert.match(render(row,true,now+16*60*1000),/21 min ago · older observation; current status unverified/);
});

test('untrusted versions, unsupported sources, ports and inventory cannot claim a provider report',()=>{
 const base=unclassified();
 const rejected=[
  {...base,evidence:undefined},
  {...base,trackerOnly:true},
  ...['Unknown provider','Direct service-port check','star4live','Star4Live '].map(source=>({...base,evidence:{...base.evidence,source}})),
  {...base,evidence:port()},
  {...base,evidence:{...port(),kind:'unknown',source:'Star4Live'}},
  {...base,evidence:{...base.evidence,resource:'camera'}},
 ];
 for(const row of rejected){assert.equal(unclassifiedProviderReport(row),undefined);assert.doesNotMatch(render(row),/resource last reported/);assert.equal(providerState(row,now),'verifying');}
 assert.doesNotMatch(render(base,false),/resource last reported/);
 const unsupported=resource(902,'Helios 8702');unsupported.evidence.source='Direct service-port check';
 assert.doesNotMatch(render(unsupported),/Last reported camera state/);
 assert.doesNotMatch(render(resource(903),false),/Last reported camera state/);
 assert.match(render({...base,evidence:undefined,serviceEvidence:port()}),/Last reported service result: ONLINE/);
});

test('verified typed provider history and its classification remain unchanged',()=>{
 for(const [type,label] of [['IPC','camera'],['NVR','recorder'],['detector','detector']]){
  const row=withStatus(resource(904,'Helios 8704',{type}),'offline');
  assert.equal(unclassifiedProviderReport(row),undefined);assert.match(render(row),new RegExp('Last reported '+label+' state: <b>OFFLINE'));
  assert.equal(providerState(row,now),'offline');
 }
});
