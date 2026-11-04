import fs from 'node:fs';
import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
// The earlier reviewed full-workspace correction is already committed on this
// branch. Refuse any unreviewed runtime, and apply only the measured 1 ms local
// display-clock correction. Camera observation and source timestamps never change.
for(const [path,expected] of [
 ['tech-checks/operations/src/savedFleetReading.ts','ceaf4642884b6f3e124a542b144dcff663b3527833c07fa1f74e70e75d4a76d6'],
 ['tech-checks/operations/src/useCameraHealth.ts','9ed906b995137e2a9b101d420a8bed390e3ac422fa84dea76e0890351f3810f0'],
])if(hash(fs.readFileSync(path,'utf8'))!==expected)throw Error('Reviewed runtime changed: '+path);
const path='tech-checks/operations/src/FleetDashboard.tsx',before='8bc749318cc57579b2b784cac66b677db0358e16fc4727fc794fb690001f417c',after='d58178f017f8d11c550e45875d57abe502391e4240ecc6a267cf57f000790120';
let s=fs.readFileSync(path,'utf8');
if(hash(s)!==after){
 if(hash(s)!==before)throw Error('Reviewed Fleet implementation changed');
 s=s.replace('import {browserFleetStorage,readFleetPresentation,saveFleetPresentation,type SavedFleetPresentation}','import {browserFleetStorage,readFleetPresentation,saveFleetPresentation,fleetDisplaySaveTime,type SavedFleetPresentation}');
 s=s.replace('  if(!readingKey||!completedReading||!boardData)return;\n  const reading={\n   checkedAt:Math.trunc(snapshotNow),','  if(!readingKey||!completedReading||!boardData)return;\n  const saveNow=Date.now(),checkedAt=fleetDisplaySaveTime(snapshotNow,saveNow);\n  if(checkedAt===null)return;\n  const reading={\n   checkedAt,');
 s=s.replace('saveFleetReading(browserFleetStorage(),readingKey,reading);','saveFleetReading(browserFleetStorage(),readingKey,reading,saveNow);');
 s=s.replace('  if(!readingKey||!completedReading||!map||!valid.current)return;\n  saveFleetPresentation','  if(!readingKey||!completedReading||!map||!valid.current)return;\n  const saveNow=Date.now(),checkedAt=fleetDisplaySaveTime(snapshotNow,saveNow);\n  if(checkedAt===null)return;\n  saveFleetPresentation');
 s=s.replace('   checkedAt:Math.floor(snapshotNow),fieldMap:map,health:cameras.data,\n   routers,vrm,sourceErrors,\n  });','   checkedAt,fieldMap:map,health:cameras.data,\n   routers,vrm,sourceErrors,\n  },saveNow);');
 if(hash(s)!==after)throw Error('Unexpected local display-clock patch output');
 fs.writeFileSync(path,s);
}
console.log('Validated full Fleet restoration and local display-clock normalization. No production deployment performed.');
