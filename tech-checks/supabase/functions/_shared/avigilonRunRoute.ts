import {createAvigilonCheckRuns,type Dependencies} from './avigilonCheckRun.ts';
/** Mount behind the existing origin/session boundary only after a durable store
 * and audited-roster adapter are supplied. No credential or permission fallback. */
export function createAvigilonRunRoute(dependencies:Dependencies){
 const runs=createAvigilonCheckRuns(dependencies);
 return async(request:Request)=>{
  const url=new URL(request.url),base='/api/avigilon-check-runs';
  if(request.method==='POST'&&url.pathname===base){
   let body:unknown;try{body=await request.json();}catch{return Response.json({error:'Empty object required'},{status:400});}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return Response.json({error:'Run inputs are server-derived'},{status:400});
   try{return Response.json(await runs.start(request),{status:202,headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Authorized fresh check run unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
  }
  if(request.method==='GET'&&url.pathname.startsWith(base+'/')){
   const id=url.pathname.slice(base.length+1);if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return Response.json({error:'Invalid run'},{status:400});
   try{return Response.json(await runs.read(request,id),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Run unavailable'},{status:404,headers:{'Cache-Control':'no-store'}});}
  }
  return Response.json({error:'Not found'},{status:404});
 };
}
