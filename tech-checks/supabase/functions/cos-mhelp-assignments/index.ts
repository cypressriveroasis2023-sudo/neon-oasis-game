/** Protected, read-only maintenance review. Never returns credentials or billing addresses. */
export const projectCustomer = (row:any, id:string, portalId:string) => {
  if (!row || String(row.customerId)!==id || String(row.portalId)!==portalId || typeof row.name!=='string' || !row.name.trim() || row.name.length>180 || /[\x00-\x1f\x7f]/.test(row.name) || typeof row.isServiceLocation!=='boolean') throw Error('Unsupported customer identity');
  const shop = ['cameras onsite','cameras onsite llc'].includes(row.name.trim().toLowerCase());
  return {customerId:id,name:row.name,isServiceLocation:row.isServiceLocation,placement:shop?'SHOP':'FIELD'};
};
export async function readAssignmentRequest(req:Request) {
  if(req.method!=='POST'||new URL(req.url).search||!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw Error('Invalid request');
  const reader=req.body?.getReader();if(!reader)throw Error('Invalid request');
  let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096)throw Error('Invalid request');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const v=JSON.parse(raw);
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid request');
  if(v.action==='equipment'&&Object.keys(v).length===1)return {action:'equipment' as const};
  if(v.action==='customers'&&Object.keys(v).length===2&&Array.isArray(v.ids)&&v.ids.length>0&&v.ids.length<=40&&new Set(v.ids).size===v.ids.length&&v.ids.every((id:unknown)=>typeof id==='string'&&/^[1-9]\d{0,14}$/.test(id)))return {action:'customers' as const,ids:v.ids as string[]};
  throw Error('Invalid request');
}
export function createAssignmentHandler(options:{authenticate:(req:Request)=>Promise<boolean>;equipment:()=>Promise<any>;customers:(ids:string[])=>Promise<any[]>}) {
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async(req:Request)=>{
    try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
    let input;try{input=await readAssignmentRequest(req);}catch{return reply({error:'Invalid assignment request'},400);}
    try{
      if(input.action==='customers')return reply({contract:'cos-mhelp-assignment-review-v1',customers:await options.customers(input.ids),readOnly:true});
      const v=await options.equipment();
      if(v.partial||!v.liveAccessVerified||!Array.isArray(v.items)||v.items.length!==v.totalRows||v.items.length>10000)throw Error('Incomplete equipment');
      return reply({contract:'cos-mhelp-assignment-review-v1',portalId:v.verifiedPortalId,totalRows:v.totalRows,readOnly:true,items:v.items.map((r:any)=>({equipmentId:r.equipmentId,name:r.name,model:r.model,customerId:r.customerId,serviceLocationId:r.serviceLocationId,active:r.active,updatedAt:r.updatedAt}))});
    }catch{return reply({error:'mHelpDesk assignment read unavailable'},503);}
  };
}
