import test from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerSchedule} from '../../schedule-read.js';
function fixture(result){const calls=[],query={};for(const name of ['select','gte','lte','neq','order'])query[name]=(...args)=>{calls.push([name,...args]);return query;};query.limit=async value=>{calls.push(['limit',value]);return result;};return {calls,db:{from:name=>{calls.push(['from',name]);return query;}}};}
test('saved appointment reader uses existing bounded RLS calendar and only projects saved dates',async()=>{
 const row={id:'synthetic-assignment',ticket_no:'SYN-1',scheduled_for:'2026-10-23',scheduled_time:'10:30:00',work_type:'Return handoff appointment',site:'Synthetic shop',status:'assigned',assigned_role:'service',private_notes:'hidden'};
 const f=fixture({data:[row],count:1});const result=await readOwnerSchedule(f.db,()=>true,'2026-10-01','2026-11-01');
 assert.equal(result.items[0].time,'10:30:00');assert.equal(result.items[0].day,'2026-10-23');assert.equal(result.truncated,false);assert.doesNotMatch(JSON.stringify(result),/hidden|private_notes/);
 assert.deepEqual(f.calls[0],['from','job_assignments']);assert.deepEqual(f.calls.at(-1),['limit',1000]);
 await assert.rejects(readOwnerSchedule(f.db,()=>true,'2026-02-30','2026-03-01'),/Invalid calendar range/);
 await assert.rejects(readOwnerSchedule(f.db,()=>true,'2026-01-01','2026-12-31'),/Invalid calendar range/);
 await assert.rejects(readOwnerSchedule(f.db,()=>false,'2026-10-01','2026-11-01'),/Session changed/);
});
test('missing counts, failed source, duplicate identity and out-of-range records cannot become an empty healthy schedule',async()=>{
 for(const result of [{data:[],count:null},{data:[],count:0,error:{}},{data:[{id:'x',scheduled_for:'2026-12-01'}],count:1},{data:[{id:'x',scheduled_for:'2026-10-20'},{id:'x',scheduled_for:'2026-10-20'}],count:2}])await assert.rejects(readOwnerSchedule(fixture(result).db,()=>true,'2026-10-01','2026-11-01'));
 const result=await readOwnerSchedule(fixture({data:[],count:1001}).db,()=>true,'2026-10-01','2026-11-01');assert.equal(result.truncated,true);assert.equal(result.total,1001);
});
