import test from 'node:test';
import assert from 'node:assert/strict';
import {boardUnitHref} from './boardUnitHref.ts';
import {resolveBoardUnitLink} from './resolveBoardUnitLink.ts';
import {readWorkspaceRoute} from '../../src/workspaceNavigation.ts';
import {fixture,JOB,UNIT,OTHER,VISIT,TASK} from './fixtures.mjs';
const record={id:JOB},link=()=>resolveBoardUnitLink('job',record,fixture());
test('resolved exact native UUID uses the unchanged Fleet route',()=>{
 const href=boardUnitHref('job',record,link(),false);assert.equal(href,'#fleet-dashboard?unit='+UNIT);
 const decoded=readWorkspaceRoute(href);assert.equal(decoded.workspace,'Fleet Dashboard');assert.equal(decoded.unitId,UNIT);assert.equal(decoded.jobId,'');assert.equal(decoded.unitLabel,undefined);
});
test('legacy Board responses without the contract stay unlinked',()=>assert.equal(boardUnitHref('job',record,null,false),null));
test('source-unavailable Board cannot expose a previously saved link',()=>assert.equal(boardUnitHref('job',record,link(),true),null));
test('link for another saved job is rejected',()=>assert.equal(boardUnitHref('job',{id:OTHER},link(),false),null));
test('not-linked response cannot carry a usable unit URL',()=>assert.equal(boardUnitHref('job',record,{...link(),state:'not_linked'},false),null));
test('wrong provenance is not upgraded into a job assignment',()=>assert.equal(boardUnitHref('job',record,{...link(),basis:'label_match'},false),null));
test('arbitrary identifier or embedded URL cannot become an executable destination',()=>assert.equal(boardUnitHref('job',record,{...link(),unitId:'javascript:alert(1)'},false),null));
test('missing proof identity or capture metadata disables the route',()=>{
 for(const key of ['productId','assignmentId','sourceSha256','assignmentAsOf','fleetAsOf','productObservedAt']){
  const value=link();delete value[key];assert.equal(boardUnitHref('job',record,value,false),null,key);
 }
});
test('completed visit links current job equipment only with an explicit current-job context',()=>{
 const r={id:`${JOB}:visit:${VISIT}`,jobId:JOB,visitId:VISIT,completionKind:'visit'};
 assert.equal(boardUnitHref('job',r,resolveBoardUnitLink('job',r,fixture()),false),'#fleet-dashboard?unit='+UNIT);
 assert.equal(boardUnitHref('job',r,link(),false),null);
});
test('task related job context is validated independently of task identity',()=>{
 const r={id:TASK,relatedJobId:JOB};assert.equal(boardUnitHref('task',r,resolveBoardUnitLink('task',r,fixture()),false),'#fleet-dashboard?unit='+UNIT);
 assert.equal(boardUnitHref('task',r,link(),false),null);
});
