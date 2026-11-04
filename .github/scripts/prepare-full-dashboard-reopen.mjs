import fs from 'node:fs';
import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function change(path,before,after,edit){const old=fs.readFileSync(path,'utf8');if(hash(old)===after)return;if(hash(old)!==before)throw Error('Unreviewed source changed: '+path);const next=edit(old);if(hash(next)!==after)throw Error('Unexpected patch output: '+path);fs.writeFileSync(path,next);}
change('tech-checks/operations/src/savedFleetReading.ts','c8ea2fabfdd2778e8c0c757b696ad8295e424be4c59ea251ce684e82df106073','ceaf4642884b6f3e124a542b144dcff663b3527833c07fa1f74e70e75d4a76d6',s=>s.replaceAll('storage: Storage,','storage: Storage | null,').replace('if (!key) return null;','if (!storage || !key) return null;').replace('if (!key || !validReading','if (!storage || !key || !validReading'));
change('tech-checks/operations/src/useCameraHealth.ts','3f730f23de6fb73c4fdc6ec17ebf6460610febb5abdd066a75486589c2095297','9ed906b995137e2a9b101d420a8bed390e3ac422fa84dea76e0890351f3810f0',s=>s.replace('export function useCameraHealth(forceOnEntry=false){','export function useCameraHealth(forceOnEntry=false,restored:{fleet:FleetSnapshot|null;readAt:number}|null=null){').replace('useState<FleetSnapshot|null>(null)','useState<FleetSnapshot|null>(()=>restored?.fleet||null)').replace('[now,setNow]=useState(Date.now())','[now,setNow]=useState(()=>restored?.readAt??Date.now())').replace('lastAttemptAt=useRef(0)','lastAttemptAt=useRef(restored?.readAt??0)').replace('useRef<FleetSnapshot|null>(null)','useRef<FleetSnapshot|null>(restored?.fleet||null)').replace('useEffect(()=>{void refresh(forceOnEntry);','useEffect(()=>{if(!restored||forceOnEntry)void refresh(forceOnEntry);'));
change('tech-checks/operations/src/FleetDashboard.tsx','637d35cc342f143aa384e861e9a4d6d60ec9b8ec09b40234b24dc368aa2fa4f2','a625495bb8e235c28d132e368c7e8d139a4ca502827f352c89b8c28d823d7bac',s=>{
 s="import {browserFleetStorage,readFleetPresentation,saveFleetPresentation,type SavedFleetPresentation} from './savedFleetPresentation';\n"+s;
 const start=s.indexOf('function FleetDashboardEntry('),end=s.indexOf('function FleetDashboardLive(',start);
 if(start<0||end<0)throw Error('Dashboard entry missing');
 s=s.slice(0,start)+`function FleetDashboardEntry(props:Props & {readingKey:string|null}){
 const [presentation]=useState(()=>readFleetPresentation(browserFleetStorage(),props.readingKey));
 // Always mount the working dashboard. A saved aggregate is not a replacement
 // for its map, search, inventory cards or verification controls.
 return <FleetDashboardLive {...props} initialPresentation={presentation}/>;
}
`+s.slice(end);
 s=s.replace('({readingKey,forceOnEntry,openMhelpConnection','({readingKey,initialPresentation,openMhelpConnection').replace('Props & {readingKey:string|null;forceOnEntry:boolean}','Props & {readingKey:string|null;initialPresentation:SavedFleetPresentation|null}');
 s=s.replace(" const cameras=useCameraHealth(forceOnEntry),[mapSnapshot,setMapSnapshot]=useState<ReturnType<typeof checkedFieldMap>|null>(null),[mapError,setMapError]=useState('');",` const initialCamera=useRef(initialPresentation?{readAt:initialPresentation.checkedAt,fleet:initialPresentation.health?{health:initialPresentation.health,fieldMap:initialPresentation.fieldMap,readAt:new Date(initialPresentation.checkedAt).toISOString(),readStartedAt:initialPresentation.checkedAt}:null}:null);
 const cameras=useCameraHealth(false,initialCamera.current),[mapSnapshot,setMapSnapshot]=useState<ReturnType<typeof checkedFieldMap>|null>(()=>initialPresentation?.fieldMap||null),[mapError,setMapError]=useState('');
 const [restoredPresentation,setRestoredPresentation]=useState(Boolean(initialPresentation));`);
 s=s.replace('const [routers,setRouters]=useState<RouterSnapshot|null>(null),[vrm,setVrm]=useState<any>(null),[sourceErrors,setSourceErrors]=useState<Record<string,string>>({})','const [routers,setRouters]=useState<RouterSnapshot|null>(()=>initialPresentation?.routers||null),[vrm,setVrm]=useState<any>(()=>initialPresentation?.vrm||null),[sourceErrors,setSourceErrors]=useState<Record<string,string>>(()=>initialPresentation?.sourceErrors||{})');
 s=s.replace('lastSourceRead=useRef(0),lastMapRead=useRef(0)','lastSourceRead=useRef(initialPresentation?.checkedAt??0),lastMapRead=useRef(initialPresentation?.checkedAt??0)');
 s=s.replace('queueMicrotask(()=>{if(active){void sources();void readMap();}});','queueMicrotask(()=>{if(active&&!initialPresentation){void sources();void readMap();}});');
 s=s.replace('readFleetReading(window.localStorage,readingKey)','readFleetReading(browserFleetStorage(),readingKey)').replace('saveFleetReading(window.localStorage,readingKey,reading);','saveFleetReading(browserFleetStorage(),readingKey,reading);');
 const pos=s.indexOf(' const effective=failed&&filters.status');if(pos<0)throw Error('Persistence insertion point missing');
 s=s.slice(0,pos)+` useEffect(()=>{
  if(!readingKey||!completedReading||!map||!valid.current)return;
  saveFleetPresentation(browserFleetStorage(),readingKey,{
   checkedAt:Math.floor(snapshotNow),fieldMap:map,health:cameras.data,
   routers,vrm,sourceErrors,
  });
  if(initialPresentation&&snapshotNow>initialPresentation.checkedAt)setRestoredPresentation(false);
 },[readingKey,completedReading,map,snapshotNow,cameras.data,routers,vrm,sourceErrors,initialPresentation]);
`+s.slice(pos);
 s=s.replace(" if(savedReading&&!completedReading&&valid.current&&view==='map'&&!initialUnitId&&!initialUnitLabel)\n  return <SavedFleetReadingView reading={savedReading} refresh={refresh} busy={loading}/>;\n",'');
 s=s.replace('  <SavedFleetHistory/>',`  {savedReading&&!completedReading&&valid.current&&view==='map'&&<div className='cos-fleet-message' role='status'><strong>Last completed reading {cameraTime(new Date(savedReading.checkedAt).toISOString(),Date.now())}</strong><p>Field {savedReading.field} · Online {savedReading.online} · Offline {savedReading.offline} · Unverified {savedReading.unverified} · Shop {savedReading.shop}. Restoring saved unit details; controls remain available.</p></div>}
  <SavedFleetHistory/>`);
 s=s.replace("{cameras.data?.refreshedAt?'Saved health '","{restoredPresentation&&initialPresentation?'Last completed reading '+cameraTime(new Date(initialPresentation.checkedAt).toISOString(),Date.now()):cameras.data?.refreshedAt?'Saved health '");
 return s.replace("import SavedFleetReadingView from './SavedFleetReadingView';\n",'');
});
console.log('Prepared scoped full-dashboard reopening correction. No production publication performed.');
