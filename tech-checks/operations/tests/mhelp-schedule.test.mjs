import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
test('coordinated half-hour schedule changes only three known jobs and refuses drift atomically',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema cron;create table cron.job(jobid bigint primary key,jobname text unique,schedule text,active boolean);
 create function cron.alter_job(job_id bigint,schedule text) returns void language sql as $$update cron.job set schedule=$2 where jobid=$1$$;
 insert into cron.job values(7,'cos-mhelp-placement-sync','8,23,38,53 * * * *',true),(8,'cos-sheets-placement-publish','10,25,40,55 * * * *',true),(10,'cos-mhelp-token-renewal','1 * * * *',true),(11,'cos-mhelp-inventory-sync','5,20,35,50 * * * *',true),(2,'camera-health-auto-sweep','0,15,30,45 * * * *',true);`);
 const sql=await readFile(new URL('../../database-maintenance/mhelp-30-minute-schedule.sql',import.meta.url),'utf8');
 await db.exec(sql);assert.deepEqual((await db.query('select jobid,schedule from cron.job order by jobid')).rows,[{jobid:2,schedule:'0,15,30,45 * * * *'},{jobid:7,schedule:'8,38 * * * *'},{jobid:8,schedule:'10,40 * * * *'},{jobid:10,schedule:'1 * * * *'},{jobid:11,schedule:'5,35 * * * *'}]);
 await assert.rejects(db.exec(sql),/schedules changed/);await db.exec('rollback');assert.equal((await db.query('select schedule from cron.job where jobid=10')).rows[0].schedule,'1 * * * *');
 }finally{await db.close();}
});
