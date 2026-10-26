import {reconcileFleetSnapshot} from './fleetSnapshot';
import {checkedFieldMap} from './gpsPersistence';
import {validateCameraHealth,type Health} from './fieldCameraHealth';
import {readRouterSnapshot,type RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';

type Api={fleetSource?:(source:'health'|'fieldMap',force?:boolean)=>Promise<any>;get:(path:string)=>Promise<{data:any}>};
type Callbacks={
  readFailure?:(source:'fieldMap'|'health'|'routers',status:number|null)=>void;
  healthUnavailable?:()=>void;
  routersUnavailable?:()=>void;
  field:(snapshot:ReturnType<typeof checkedFieldMap>)=>void|Promise<void>;
  health:(snapshot:Health)=>void|Promise<void>;
  routers:(snapshot:RouterSnapshot)=>void|Promise<void>;
};

/** Accept each verified feed as it arrives; an optional outage cannot hide locations. */
export async function loadTvFleetFeeds(api:Api,callbacks:Callbacks,force=false):Promise<string[]> {
  const errors:string[]=[];
  let field:ReturnType<typeof checkedFieldMap>|null=null,health:Health|null=null;
  const read=async<T>(label:string,path:string,check:(value:any)=>T,accept:(value:T)=>void|Promise<void>)=>{
    try {const value=api.fleetSource&&['/api/field-map','/api/camera-health/summary-v3'].includes(path)?await api.fleetSource(path==='/api/field-map'?'fieldMap':'health',force):(await api.get(path)).data;await accept(check(value));}
    catch(cause){const status=(cause as {response?:{status?:unknown}})?.response?.status;callbacks.readFailure?.(label==='Field locations'?'fieldMap':label==='Camera Health'?'health':'routers',typeof status==='number'?status:null);if(label==='Camera Health'){health=null;callbacks.healthUnavailable?.();}if(label==='Routers')callbacks.routersUnavailable?.();errors.push(label+': '+(cause instanceof Error?cause.message:'Information is unavailable.'));}
  };
  await Promise.all([
    read('Field locations','/api/field-map',checkedFieldMap,async snapshot=>{field=snapshot;await callbacks.field(snapshot);if(health)await callbacks.health(reconcileFleetSnapshot(health,snapshot).health);}),
    read('Camera Health','/api/camera-health/summary-v3',validateCameraHealth,async snapshot=>{health=snapshot;await callbacks.health(field?reconcileFleetSnapshot(snapshot,field).health:snapshot);}),
    read('Routers','/api/routers',readRouterSnapshot,callbacks.routers)
  ]);
  return errors;
}
