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
/** `include` lets the camera saved reads (field map + camera health) and the
 * router saved read run on separate cadences. Camera evidence expires against
 * the provider's observation time so it is read more often than the default
 * interval; routers have no freshness window and are not cached by
 * api.fleetSource, so they keep the default interval instead of inheriting the
 * camera one. Each side must also be schedulable alone: tying the router read
 * to the next camera deadline stretches it to the camera interval's next
 * multiple, and forcing a camera read merely to carry routers would reset the
 * camera deadline. The default reads all three together, which is what a
 * manual refresh and the initial load want. */
export async function loadTvFleetFeeds(api:Api,callbacks:Callbacks,force=false,include:{camera?:boolean;routers?:boolean}={}):Promise<string[]> {
  const readCamera=include.camera!==false,readRouters=include.routers!==false;
  const errors:string[]=[];
  let field:ReturnType<typeof checkedFieldMap>|null=null,health:Health|null=null;
  const read=async<T>(label:string,path:string,check:(value:any)=>T,accept:(value:T)=>void|Promise<void>)=>{
    try {const value=api.fleetSource&&['/api/field-map','/api/camera-health/summary-v3'].includes(path)?await api.fleetSource(path==='/api/field-map'?'fieldMap':'health',force):(await api.get(path)).data;await accept(check(value));}
    catch(cause){const status=(cause as {response?:{status?:unknown}})?.response?.status;callbacks.readFailure?.(label==='Field locations'?'fieldMap':label==='Camera Health'?'health':'routers',typeof status==='number'?status:null);if(label==='Camera Health'){health=null;callbacks.healthUnavailable?.();}if(label==='Routers')callbacks.routersUnavailable?.();errors.push(label+': '+(cause instanceof Error?cause.message:'Information is unavailable.'));}
  };
  await Promise.all([
    ...(readCamera?[
      read('Field locations','/api/field-map',checkedFieldMap,async snapshot=>{field=snapshot;await callbacks.field(snapshot);if(health)await callbacks.health(reconcileFleetSnapshot(health,snapshot).health);}),
      read('Camera Health','/api/camera-health/summary-v3',validateCameraHealth,async snapshot=>{health=snapshot;await callbacks.health(field?reconcileFleetSnapshot(snapshot,field).health:snapshot);})
    ]:[]),
    ...(readRouters?[read('Routers','/api/routers',readRouterSnapshot,callbacks.routers)]:[])
  ]);
  return errors;
}

/** Errors belong to the source that produced them. A pass that did not read a
 * source cannot speak for it, so its previous errors are retained rather than
 * cleared. Without this a successful router-only read reports no errors and
 * wipes an unresolved camera warning that no camera read has resolved - the
 * warning disappears while the condition causing it persists. Labels come from
 * the read() calls below: 'Field locations: ', 'Camera Health: ' and
 * 'Routers: '. Field and camera share a group because they are always read
 * together as the camera saved pair. */
export type RetainedSourceErrors = {camera:string[];routers:string[]};
export const ROUTER_ERROR_PREFIX='Routers:';
export function retainSourceErrors(
 previous:RetainedSourceErrors,
 errors:readonly string[],
 read:{camera:boolean;routers:boolean}
):RetainedSourceErrors {
 return {
  camera:read.camera?errors.filter(message=>!message.startsWith(ROUTER_ERROR_PREFIX)):previous.camera,
  routers:read.routers?errors.filter(message=>message.startsWith(ROUTER_ERROR_PREFIX)):previous.routers
 };
}
export const sourceErrorText=(retained:RetainedSourceErrors)=>[...retained.camera,...retained.routers].join(' ');
