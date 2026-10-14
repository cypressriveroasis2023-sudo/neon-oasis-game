// Local synthetic timing only. PGlite worker engines do not prove shared PostgreSQL concurrency.
import assert from 'node:assert/strict';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {writeFile} from 'node:fs/promises';
import {representativeFixture,snapshot,baselineSql,candidateSql} from './fixtures/placement-snapshot-dedup.mjs';
const round=n=>Math.round(n*100)/100;
const stats=values=>({samplesMs:values.map(round),meanMs:round(values.reduce((a,b)=>a+b,0)/values.length),maxMs:round(Math.max(...values))});
async function timed(f,expected){const start=performance.now();const value=await snapshot(f.db);const ms=performance.now()-start;assert.deepEqual(value,expected);return ms;}
if(!isMainThread){
 let f;try{
  f=await representativeFixture();const expected=await snapshot(f.db);
  if(workerData.variant==='candidate')await f.db.exec(candidateSql);
  await timed(f,expected);parentPort.postMessage({ready:true});
  await new Promise(resolve=>parentPort.once('message',resolve));
  const samples=[];for(let i=0;i<2;i++)samples.push(await timed(f,expected));
  parentPort.postMessage({samples});
 }catch(e){parentPort.postMessage({error:e.message});process.exitCode=1;}finally{await f?.db.close();}
}else{
 const report={syntheticOnly:true,productionWrites:0,providerCalls:0,engine:'PGlite',concurrencyLimitation:'Two independent worker-thread engines share CPU; this is not shared PostgreSQL MVCC, pool or lock proof.'};
 const f=await representativeFixture();try{
  report.population=f.population;const expected=await snapshot(f.db);const samples={baseline:[],candidate:[]};
  for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){
   await f.db.exec(variant==='baseline'?baselineSql:candidateSql);samples[variant].push(await timed(f,expected));
  }
  report.sequential={baseline:stats(samples.baseline),candidate:stats(samples.candidate)};
 }finally{await f.db.close();}
 async function concurrent(variant){
  const workers=Array.from({length:2},()=>new Worker(new URL(import.meta.url),{workerData:{variant}}));
  const ready=workers.map(w=>new Promise((resolve,reject)=>{w.once('error',reject);w.once('message',m=>m.error?reject(Error(m.error)):resolve());}));
  try{
   await Promise.all(ready);const result=workers.map(w=>new Promise((resolve,reject)=>{w.once('error',reject);w.once('message',m=>m.error?reject(Error(m.error)):resolve(m.samples));}));
   const start=performance.now();workers.forEach(w=>w.postMessage('go'));const samples=await Promise.all(result);
   return {...stats(samples.flat()),burstWallMs:round(performance.now()-start),clients:2,readsPerClient:2};
  }finally{await Promise.all(workers.map(w=>w.terminate()));}
 }
 report.concurrentIndependentEngines={baseline:await concurrent('baseline'),candidate:await concurrent('candidate')};
 report.sequentialMeanReductionPercent=round(100*(1-report.sequential.candidate.meanMs/report.sequential.baseline.meanMs));
 await writeFile(process.env.COS_SNAPSHOT_BENCHMARK_REPORT||'placement-snapshot-benchmark-results.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
