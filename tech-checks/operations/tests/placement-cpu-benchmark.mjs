import fs from 'node:fs';
import assert from 'node:assert/strict';
import {currentOwnerPlacements as baseline} from './fixtures/placement-cpu-baseline.mjs';
import {currentOwnerPlacements as candidate} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {fixture} from './fixtures/placement-cpu-population.mjs';
const report={syntheticOnly:true,engine:process.version,productionRequests:0,providerCalls:0,scope:'currentOwnerPlacements only; not hosted request latency or demonstrated production trigger',populations:[]};
for(const count of [100,1001]){
 const f=fixture(count),expected=baseline(f.audits,f.devices),samples={baseline:[],candidate:[]};
 for(let i=0;i<5;i++)for(const [name,fn] of i%2?[['candidate',candidate],['baseline',baseline]]:[['baseline',baseline],['candidate',candidate]]){
  const cpu=process.cpuUsage(),start=performance.now(),out=fn(f.audits,f.devices),usage=process.cpuUsage(cpu);
  samples[name].push({cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start});assert.deepEqual(out,expected);
 }
 report.populations.push({units:count,devices:f.devices.length,audits:f.audits.length,samples});
}
fs.writeFileSync(process.env.COS_CPU_REPORT||'/tmp/cos-cpu-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
