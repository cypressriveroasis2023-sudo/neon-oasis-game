/** Existing scheduler authentication; source reads and private placement receipts only. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const held=(id:string,reason:string)=>({equipmentId:id,state:'held',reason});
export async function collectPlacementObservations(links:Row[],equipment:Row[],readCustomer:(id:string)=>Promise<Row|null>){
 if(!Array.isArray(links)||links.length>1000||!Array.isArray(equipment)||equipment.length>10000||new Set(equipment.map(r=>r.equipmentId)).size!==equipment.length)throw Error('Invalid equipment inventory');
 const byId=new Map(equipment.map(r=>[r.equipmentId,r]));
 const ids=[...new Set(links.flatMap(l=>{const r=byId.get(l.equipmentId);return r?[r.customerId,r.serviceLocationId].filter(Boolean):[];}))] as string[];
 const customers=new Map<string,Row|null>();let next=0;
 // One bounded worker pool, rather than overlapping per-page customer pools.
 await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];try{const row=await readCustomer(id);customers.set(id,row&&row.customerId===id?row:null);}catch{customers.set(id,null);}}}));
 return links.map(link=>{
  const r=byId.get(link.equipmentId);
  if(!r)return held(link.equipmentId,'equipment_missing');
  if(r.name!==link.fullLabel||r.model!==link.model||r.active===false||/\b(?:DO NOT USE|MISSING|RETIRED|DECOMMISSIONED|STOLEN)\b/i.test(r.name))return held(link.equipmentId,'identity_or_lifecycle_changed');
  const customer=customers.get(r.customerId),site=customers.get(r.serviceLocationId);
  if(!customer||customer.isServiceLocation!==false||!['SHOP','FIELD'].includes(customer.placement))return held(link.equipmentId,'customer_unverified');
  if(customer.placement==='FIELD'&&(!site||site.isServiceLocation!==true))return held(link.equipmentId,'service_location_unverified');
  return {equipmentId:link.equipmentId,state:'confirmed',customerId:r.customerId,serviceLocationId:r.serviceLocationId,
   placement:customer.placement,customerLabel:customer.name.trim(),siteLabel:customer.placement==='SHOP'?'SHOP':site!.name.trim()};
 });
}
export function createPlacementSyncHandler(options:{authenticate:(req:Request)=>Promise<boolean>;rpc:(name:string,body:Row)=>Promise<any>;equipment:()=>Promise<Row[]>;customer:(id:string)=>Promise<Row|null>;locations?:(equipment:Row[])=>Promise<Row[]>}){
 return async(req:Request)=>{
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(req.method!=='POST'||new URL(req.url).search||req.headers.has('origin'))return reply({error:'Scheduled request required'},405);
  try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
  let action:string;
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))throw Error();
   const reader=req.body?.getReader();if(!reader)throw Error();let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64)throw Error();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{try{void reader.cancel().catch(()=>{});}catch{}}
   const v=JSON.parse(raw);if(!object(v)||Object.keys(v).length!==1||!['run','status'].includes(v.action))throw Error();action=v.action;
  }catch{return reply({error:'Invalid sync request'},400);}
  let lease:string|null=null;
  try{
   if(action==='status')return reply(await options.rpc('cos_mhelp_placement_status',{}));
   const start=await options.rpc('cos_mhelp_placement_begin',{});
   if(start.leaseId===null)return reply({state:'busy_or_disabled'});
   if(typeof start.leaseId!=='string'||!Array.isArray(start.links))throw Error('Invalid lease');lease=start.leaseId;
   const equipment=await options.equipment();const observations=await collectPlacementObservations(start.links,equipment,options.customer);
   const locations=options.locations?await options.locations(equipment):null;
   const result=await options.rpc(locations?'cos_mhelp_fleet_finish':'cos_mhelp_placement_finish',{p_lease_id:lease,p_observations:observations,...(locations?{p_locations:locations}:{})});
   if(!object(result)||result.committed!==true)throw Error('Lost lease');
   return reply({state:'current',...result});
  }catch{if(lease)try{await options.rpc('cos_mhelp_placement_fail',{p_lease_id:lease});}catch{}return reply({error:'mHelpDesk placement sync unavailable'},503);}
 };
}
