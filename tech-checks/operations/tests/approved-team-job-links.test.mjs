import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedTeamJobRoute} from '../src/approvedTeamJobRoute.ts';
import {readWorkspaceRoute} from '../src/workspaceNavigation.ts';
const uuid='11111111-1111-4111-8111-111111111111';
const hash=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0'+b).digest('hex');

test('uses the exact existing Jobs route and round-trips the saved identifier',()=>{
 const href=approvedTeamJobRoute(uuid); assert.equal(href,'#jobs?job='+uuid);
 assert.deepEqual(readWorkspaceRoute(href),{workspace:'Jobs',jobId:uuid,detail:false});
});
test('keeps distinct saved UUIDs distinct despite any duplicate display number',()=>{
 const other='22222222-2222-4222-8222-222222222222';
 assert.notEqual(approvedTeamJobRoute(uuid),approvedTeamJobRoute(other));
});
test('rejects absent, malformed, composite, padded, nil and external identifiers',()=>{
 for(const id of [null,undefined,42,{},[],{id:uuid},'', 'COS-JOB-1',' '+uuid,uuid+' ',uuid+'\n',uuid+':visit:'+uuid,'https://example.com/'+uuid,'javascript:alert(1)','00000000-0000-0000-0000-000000000000']) assert.equal(approvedTeamJobRoute(id),null,String(id));
});
test('accepts the original hexadecimal UUID spelling without rewriting its identity',()=>{
 const id='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';assert.equal(approvedTeamJobRoute(id),'#jobs?job='+id);
});
test('exact presentation reversal preserves every original Team reader, assignment, count and filter',()=>{
 const source=readFileSync(new URL('../src/TeamWorkspace.tsx',import.meta.url),'utf8');
 const imp="import ApprovedTeamJobLink from './ApprovedTeamJobLink';\n",node='<ApprovedTeamJobLink jobId={job.id} jobNumber={job.jobNumber}/>';
 assert.equal(source.split(imp).length,2);assert.equal(source.split(node).length,2);
 assert.equal(hash(source.replace(imp,'').replace(node,'<b>{job.jobNumber}</b>')),'b04caf1a76ec44ba22b09e914f59c3c2808b6ab4');
});
test('new presentation has no reader, write, state, record matching or new job action',()=>{
 const component=readFileSync(new URL('../src/ApprovedTeamJobLink.tsx',import.meta.url),'utf8');
 assert.match(component,/href=\{href\}/); assert.match(component,/Job link unavailable/);
 assert.doesNotMatch(component,/api\.|fetch\(|openLegacy|localStorage|setInterval|setTimeout|onClick|useEffect|useState/);
 const route=readFileSync(new URL('../src/approvedTeamJobRoute.ts',import.meta.url),'utf8');
 assert.doesNotMatch(route,/unitId\s*:|jobNumber|equipmentUnitTag|ipAddress/);
});
