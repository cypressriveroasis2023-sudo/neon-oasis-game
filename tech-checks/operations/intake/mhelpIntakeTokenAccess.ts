/** The original native manager is reused unchanged; no parallel store or copied project keys. */
import {nativeMhelpTokens} from '../../supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts';
import {INTAKE_LIMITS,IntakeFault,identity,row,type Window} from './mhelpIntakeRuntime.ts';
import {readBoundedJson} from './mhelpIntakeHandlers.ts';
const API='https://connect.mhelpdesk.com/api/v1.0';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const transient=(status:number)=>[408,429,500,502,503,504].includes(status);
export function createNativeMhelpTicketAccess(options:{env:(name:string)=>string|undefined;fetch:typeof fetch;tokens?:ReturnType<typeof nativeMhelpTokens>}){
  // Instantiate once per native function instance, sharing its existing manager's
  // single-flight renewal and durable DB rotation lease with ordinary maintenance.
  const tokens=options.tokens??nativeMhelpTokens(options.env,options.fetch);
  return {begin:async(portalId:string,signal:AbortSignal)=>{
    if(options.env('SUPABASE_URL')!==NATIVE)throw new IntakeFault('CONFIGURATION');identity(portalId);
    let config:{accessToken?:string;portalId?:string};try{config=await tokens.getPartnerConfig();}catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    const validate=()=>{if(typeof config.accessToken!=='string'||!config.accessToken||/\s/.test(config.accessToken)||config.accessToken.length>16384||config.portalId!==portalId)throw new IntakeFault('CONFIGURATION');};validate();
    const get=async(path:string,max:number)=>{
      let response:Response;try{response=await options.fetch(API+path,{method:'GET',headers:{Authorization:'Bearer '+config.accessToken,Accept:'application/json'},redirect:'error',cache:'no-store',signal});}catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
      return {response,read:()=>readBoundedJson(response.body,max,signal)};
    };
    let account=await get('/users/me',16384);
    if(account.response.status===401){
      await account.response.body?.cancel().catch(()=>{});
      try{const renewed=await tokens.renewAccess();if(!renewed)throw new IntakeFault('SOURCE_UNAVAILABLE',true);config=renewed;}catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}validate();
      if(signal.aborted)throw new IntakeFault('DEADLINE',true);
      account=await get('/users/me',16384);
    }
    if(!account.response.ok){await account.response.body?.cancel().catch(()=>{});throw new IntakeFault('SOURCE_UNAVAILABLE',transient(account.response.status));}
    const value=row(await account.read());
    const verifiedPortal=typeof value.portalId==='number'&&Number.isSafeInteger(value.portalId)?String(value.portalId):value.portalId;
    if(verifiedPortal!==portalId)throw new IntakeFault('CONFIGURATION');
    const fixedRead=async(path:string)=>{const v=await get('/portal/'+portalId+path,1048576);if(!v.response.ok){await v.response.body?.cancel().catch(()=>{});throw new IntakeFault('SOURCE_UNAVAILABLE',transient(v.response.status));}return v.read();};
    return {
      readTypes:()=>fixedRead('/tickettypes'),readStatuses:()=>fixedRead('/ticketstatus'),
      readTicketPage:(input:Window&{offset:number;pageSize:50})=>{
        if(!Number.isSafeInteger(input.offset)||input.offset<0||input.offset>=INTAKE_LIMITS.maxTickets||input.pageSize!==50)throw new IntakeFault('CONFIGURATION');
        const params=new URLSearchParams({createStart:input.createdAfter,createEnd:input.createdBefore,pageSize:'50',sort:'ticketId'});
        if(input.offset)params.set('rowIndex',String(input.offset));
        // The verified schema adapter must confirm rowIndex semantics before activation.
        return fixedRead('/Tickets?'+params.toString());
      },
    };
  }};
}
