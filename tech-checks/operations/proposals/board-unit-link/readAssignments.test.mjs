import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {resolveBoardUnitLink} from './resolveBoardUnitLink.ts';
import {fixture,ORG,OTHER,JOB,UNIT,ASSIGN} from './fixtures.mjs';
const sql=readFileSync(new URL('./readAssignments.sql',import.meta.url),'utf8');
const JOB2='88888888-8888-4888-8888-888888888888';let db;
before(async()=>{
 db=new PGlite();await db.exec(`
 CREATE TABLE public.jobs(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
 CREATE TABLE public.equipment_units(id uuid PRIMARY KEY,organization_id uuid NOT NULL,status text,retired_at timestamptz);
 CREATE TABLE public.equipment_assignments(id uuid PRIMARY KEY,job_id uuid REFERENCES public.jobs(id),equipment_unit_id uuid REFERENCES public.equipment_units(id),assignment_type text,status text,assigned_at timestamptz,released_at timestamptz);
 `);
});
after(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('TRUNCATE public.equipment_assignments,public.jobs,public.equipment_units;');
 await db.query('INSERT INTO public.jobs VALUES($1,$2),($3,$4)',[JOB,ORG,JOB2,OTHER]);
 await db.query("INSERT INTO public.equipment_units VALUES($1,$2,'deployed',null)",[UNIT,ORG]);
});
async function assign(id=ASSIGN){await db.query("INSERT INTO public.equipment_assignments VALUES($1,$2,$3,'primary_job_unit','active','2025-01-01T00:00:00Z',null)",[id,JOB,UNIT]);}
async function read(org=ORG,jobs=[JOB]){return (await db.query(sql,[org,jobs])).rows[0].snapshot;}
function projected(snapshot){const e=fixture();e.assignments={...snapshot,readState:'current'};e.asOf=snapshot.asOf;return resolveBoardUnitLink('job',{id:JOB},e);}
test('query is a SELECT, not an installed function, grant, schema change or data mutation',()=>{
 const executable=sql.replace(/--[^\n]*/g,'');assert.match(executable,/^\s*WITH /);
 assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|TRUNCATE)\b/i);
});
test('zero saved assignments returns complete empty facts, never a manufactured unit',async()=>{
 const v=await read();assert.equal(v.complete,true);assert.deepEqual(v.items,[]);assert.deepEqual(v.jobIds,[JOB]);assert.equal('readState'in v,false);
 assert.equal(projected(v).reason,'no_saved_assignment');
});
test('exact saved same-company UUID relationship is returned',async()=>{
 await assign();const v=await read();assert.equal(v.complete,true);assert.equal(v.items.length,1);assert.equal(v.items[0].unitId,UNIT);
 assert.equal(v.items[0].sameOrganization,true);assert.equal(v.items[0].assignmentId,ASSIGN);
 // Make all independent fixture capture instants no later than the actual SQL capture.
 const e=fixture();e.assignments={...v,readState:'current'};e.asOf=v.asOf;e.fleet.asOf=v.asOf;
 const r=resolveBoardUnitLink('job',{id:JOB},e);assert.equal(r.state,'linked');assert.equal(r.unitId,UNIT);
});
test('two active assignments are retained even when both refer to the same unit',async()=>{
 await assign();await assign(OTHER);const v=await read();assert.equal(v.items.length,2);assert.equal(projected(v).reason,'multiple_saved_assignments');
});
test('released active row remains visible to the rejection rule',async()=>{
 await assign();await db.query('UPDATE public.equipment_assignments SET released_at=$1 WHERE id=$2',['2025-02-01T00:00:00Z',ASSIGN]);
 const v=await read();assert.ok(v.items[0].releasedAt);assert.equal(projected(v).reason,'invalid_assignment');
});
test('non-active or non-primary rows cannot establish a link',async()=>{
 await assign();await db.exec("UPDATE public.equipment_assignments SET status='released'");assert.deepEqual((await read()).items,[]);
 await db.exec("UPDATE public.equipment_assignments SET status='active',assignment_type='spare'");assert.deepEqual((await read()).items,[]);
});
test('cross-company native unit is marked invalid and its identifier/status are redacted',async()=>{
 await assign();await db.query('UPDATE public.equipment_units SET organization_id=$1',[OTHER]);const v=await read();
 assert.equal(v.items[0].unitId,null);assert.equal(v.items[0].unitStatus,null);assert.equal(v.items[0].sameOrganization,false);
 assert.equal(projected(v).reason,'invalid_assignment');
});
test('job from another company rejects complete scope instead of silently returning an empty success',async()=>{
 await assign();const v=await read(OTHER,[JOB]);assert.equal(v.complete,false);assert.deepEqual(v.items,[]);assert.deepEqual(v.jobIds,[]);
});
test('mixed tenant job scope is rejected as a whole',async()=>{
 await assign();const v=await read(ORG,[JOB,JOB2]);assert.equal(v.complete,false);assert.deepEqual(v.items,[]);
});
test('unknown requested job is not reported as a complete read',async()=>assert.equal((await read(ORG,[OTHER])).complete,false));
test('duplicate job scopes are rejected',async()=>assert.equal((await read(ORG,[JOB,JOB])).complete,false));
test('null organization, scope, or scope element are rejected',async()=>{
 for(const [org,jobs]of [[null,[JOB]],[ORG,null],[ORG,[null]]])assert.equal((await read(org,jobs)).complete,false);
});
test('empty authorized scope is a valid empty result',async()=>{const v=await read(ORG,[]);assert.equal(v.complete,true);assert.deepEqual(v.items,[]);});
test('more than 500 requested identifiers is explicitly incomplete',async()=>assert.equal((await read(ORG,Array(501).fill(JOB))).complete,false));
test('more than 2000 assignment rows is explicitly incomplete, not truncated or latest-wins',async()=>{
 await db.query(`INSERT INTO public.equipment_assignments SELECT md5(i::text)::uuid,$1,$2,'primary_job_unit','active','2025-01-01'::timestamptz,null FROM generate_series(1,2001) i`,[JOB,UNIT]);
 const v=await read();assert.equal(v.complete,false);assert.deepEqual(v.items,[]);
});
test('retirement is kept for resolver rejection, without altering saved equipment',async()=>{
 await assign();await db.query('UPDATE public.equipment_units SET retired_at=$1',['2025-02-01T00:00:00Z']);const v=await read();
 assert.ok(v.items[0].retiredAt);assert.equal(projected(v).reason,'unit_inactive');
});
test('reading does not change any saved assignment or equipment row',async()=>{
 await assign();const before=(await db.query('SELECT to_jsonb(a) AS row FROM public.equipment_assignments a')).rows;
 await read();assert.deepEqual((await db.query('SELECT to_jsonb(a) AS row FROM public.equipment_assignments a')).rows,before);
});
