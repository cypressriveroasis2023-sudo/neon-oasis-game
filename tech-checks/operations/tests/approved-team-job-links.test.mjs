import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedTeamJobRoute} from '../src/approvedTeamJobRoute.ts';
import {readWorkspaceRoute} from '../src/workspaceNavigation.ts';
const uuid='11111111-1111-4111-8111-111111111111';
const hash=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0'+b).digest('hex');

test('job links are not reachable and land on Today',()=>{
 const href=approvedTeamJobRoute(uuid); assert.equal(href,'#today');
 assert.equal(readWorkspaceRoute(href).workspace,'Today');
 const source=readFileSync(new URL('../src/TeamWorkspace.tsx',import.meta.url),'utf8');
 assert.equal(source.includes('ApprovedTeamJobLink'),false);
 assert.equal(source.includes("'/api/jobs'"),false);
 assert.match(source,/\/api\/team-production/);
});
test('rejects absent, malformed, composite, padded, nil and external identifiers',()=>{
 for(const id of [null,undefined,42,{},[],{id:uuid},'', 'COS-JOB-1',' '+uuid,uuid+' ',uuid+'\n',uuid+':visit:'+uuid,'https://example.com/'+uuid,'javascript:alert(1)','00000000-0000-0000-0000-000000000000']) assert.equal(approvedTeamJobRoute(id),null,String(id));
});
test('accepts the original hexadecimal UUID spelling without rewriting its identity',()=>{
 const id='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';assert.equal(approvedTeamJobRoute(id),'#today');
});
test('Team no longer renders job links or a jobs fetch',()=>{
 const source=readFileSync(new URL('../src/TeamWorkspace.tsx',import.meta.url),'utf8');
 assert.equal(source.includes('ApprovedTeamJobLink'),false);
 assert.equal(source.includes('/api/jobs'),false);
});
test('new presentation has no reader, write, state, record matching or new job action',()=>{
 const component=readFileSync(new URL('../src/ApprovedTeamJobLink.tsx',import.meta.url),'utf8');
 assert.match(component,/href=\{href\}/); assert.match(component,/Job link unavailable/);
 assert.doesNotMatch(component,/api\.|fetch\(|openLegacy|localStorage|setInterval|setTimeout|onClick|useEffect|useState/);
 const route=readFileSync(new URL('../src/approvedTeamJobRoute.ts',import.meta.url),'utf8');
 assert.doesNotMatch(route,/unitId\s*:|jobNumber|equipmentUnitTag|ipAddress/);
});
