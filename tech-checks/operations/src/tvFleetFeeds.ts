import {checkedFieldMap} from './gpsPersistence';
import {validateCameraHealth,type Health} from './fieldCameraHealth';
import {readRouterSnapshot,type RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';

type Api={get:(path:string)=>Promise<{data:any}>};
type Callbacks={
  field:(snapshot:ReturnType<typeof checkedFieldMap>)=>void|Promise<void>;
  health:(snapshot:Health)=>void|Promise<void>;
  routers:(snapshot:RouterSnapshot)=>void|Promise<void>;
};

/** Accept each verified feed as it arrives; an optional outage cannot hide locations. */
export async function loadTvFleetFeeds(api:Api,callbacks:Callbacks):Promise<string[]> {
  const errors:string[]=[];
  const read=async<T>(label:string,path:string,check:(value:any)=>T,accept:(value:T)=>void|Promise<void>)=>{
    try {await accept(check((await api.get(path)).data));}
    catch(cause){errors.push(label+': '+(cause instanceof Error?cause.message:'Information is unavailable.'));}
  };
  await Promise.all([
    read('Field locations','/api/field-map',checkedFieldMap,callbacks.field),
    read('Camera Health','/api/camera-health/summary-v3',validateCameraHealth,callbacks.health),
    read('Routers','/api/routers',readRouterSnapshot,callbacks.routers)
  ]);
  return errors;
}
