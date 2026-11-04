import fs from 'node:fs';
import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const [path,expected] of [
 ['tech-checks/operations/src/savedFleetReading.ts','ceaf4642884b6f3e124a542b144dcff663b3527833c07fa1f74e70e75d4a76d6'],
 ['tech-checks/operations/src/useCameraHealth.ts','9ed906b995137e2a9b101d420a8bed390e3ac422fa84dea76e0890351f3810f0'],
])if(hash(fs.readFileSync(path,'utf8'))!==expected)throw Error('Reviewed runtime changed: '+path);
const path='tech-checks/operations/src/FleetDashboard.tsx',before='d58178f017f8d11c550e45875d57abe502391e4240ecc6a267cf57f000790120',after='891fac6ed567782dd0c4810fe3f7e581b9d3552debc5ca13f8546028eaf888e9';
let s=fs.readFileSync(path,'utf8');
if(hash(s)!==after){
 if(hash(s)!==before)throw Error('Reviewed Fleet implementation changed');
 const old=` useLayoutEffect(()=>{
  if(!readingKey||!completedReading||!map||!valid.current)return;
  const saveNow=Date.now(),checkedAt=fleetDisplaySaveTime(snapshotNow,saveNow);
  if(checkedAt===null)return;
  saveFleetPresentation(browserFleetStorage(),readingKey,{
   checkedAt,fieldMap:map,health:cameras.data,
   routers,vrm,sourceErrors,
  },saveNow);
  if(initialPresentation&&snapshotNow>initialPresentation.checkedAt)setRestoredPresentation(false);
 },[readingKey,completedReading,map,snapshotNow,cameras.data,routers,vrm,sourceErrors,initialPresentation]);`;
 const replacement=` useEffect(()=>{
  if(!readingKey||!completedReading||!map)return;
  let cancelled=false,attempts=0,timer:number|undefined;
  const stop=()=>{cancelled=true;window.clearTimeout(timer);};
  // Only retry this already accepted LOCAL presentation. Never repeat a camera
  // check, renew its evidence, or write after account/source invalidation.
  const persist=()=>{
   if(cancelled)return;
   const saveNow=Date.now(),checkedAt=fleetDisplaySaveTime(snapshotNow,saveNow);
   const saved=valid.current&&checkedAt!==null&&saveFleetPresentation(browserFleetStorage(),readingKey,{
    checkedAt,fieldMap:map,health:cameras.data,routers,vrm,sourceErrors,
   },saveNow);
   if(saved){if(initialPresentation&&snapshotNow>initialPresentation.checkedAt)setRestoredPresentation(false);return;}
   if(++attempts<3)timer=window.setTimeout(persist,500);
  };
  window.addEventListener('cos-private-data-invalidated',stop);
  persist();
  return()=>{stop();window.removeEventListener('cos-private-data-invalidated',stop);};
 },[readingKey,completedReading,map,snapshotNow,cameras.data,routers,vrm,sourceErrors,initialPresentation]);`;
 if(s.split(old).length!==2)throw Error('Unexpected persistence block');
 s=s.replace(old,replacement);
 if(hash(s)!==after)throw Error('Unexpected local persistence patch output');
 fs.writeFileSync(path,s);
}
console.log('Validated full Fleet restoration, exact original reading times and bounded session-fenced local saves. No deployment performed.');
