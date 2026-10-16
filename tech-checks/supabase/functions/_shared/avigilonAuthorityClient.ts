import type {SourceCommand} from './avigilonSourceCoordinator.ts';
const sources=new Set(['camera_devices','equipment_master','camera_inventory_audit']);
/** Server-only interception of the existing Supabase write chains. Source reads
 * still use their original client. Unsupported mutation shapes fail closed. */
export function avigilonAuthorityClient(db:any,coordinator?:{mutate:(commands:SourceCommand[])=>Promise<any>}){
 if(!coordinator)return db;
 return new Proxy(db,{get(target,property){if(property==='rpc')return (name:string,args:any)=>name==='cos_apply_recon_event_v1'?coordinator.mutate([{action:'rpc',name,args}]).then(r=>{if(!r.receipt||r.receipt.cancelled)throw Error('Source event receipt unavailable');return {data:r.receipt.results[0],error:null};}).catch(()=>({data:null,error:{message:'Source event held for durable reconciliation'}})):target.rpc(name,args);if(property!=='from'){const v=target[property];return typeof v==='function'?v.bind(target):v;}
  return (table:string)=>{const builder=target.from(table);if(!sources.has(table))return builder;
   return new Proxy(builder,{get(query,method){if(!['update','insert','upsert','delete'].includes(String(method))){const v=query[method];return typeof v==='function'?v.bind(query):v;}
    return (values:any={},options:any={})=>{
     const rows=Array.isArray(values)?values:[values];const commands:SourceCommand[]=rows.map(values=>({table,action:method as SourceCommand['action'],...(method!=='delete'?{values}:{}),...((method==='upsert')?{onConflict:options.onConflict||'id'}:{})}));
     let single=false,pending:Promise<any>|undefined;
     const chain:any={eq:(key:string,value:unknown)=>{for(const c of commands)c.eq={...c.eq,[key]:value};return chain;},select:()=>chain,single:()=>{single=true;return chain;},maybeSingle:()=>{single=true;return chain;},abortSignal:()=>chain,
      then:(resolve:any,reject:any)=>{pending??=coordinator.mutate(commands).then(result=>{if(!result.receipt||result.receipt.cancelled)throw Error('Source mutation receipt unavailable');const data=result.receipt.results.flat();return {data:single?data[0]??null:data,error:null};}).catch(()=>({data:null,error:{message:'Source mutation held; reconcile its durable operation before retrying'}}));return pending.then(resolve,reject);}};
     return new Proxy(chain,{get(c,key){if(key in c)return c[key];throw Error('Unsupported guarded source mutation chain: '+String(key));}});
    };
   }});
  };
 }});
}
