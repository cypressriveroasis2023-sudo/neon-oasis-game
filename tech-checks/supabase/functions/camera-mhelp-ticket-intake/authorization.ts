/** Genuine legacy identity verification. No JWT decoding, actor override or synthetic Owner session. */
export type OwnerAuthClient={
  auth:{getUser:(token:string)=>Promise<{data:{user:{id:string;is_anonymous?:boolean}|null};error:unknown}>};
  from:(table:string)=>{select:(columns:string)=>{eq:(column:string,value:string)=>{limit:(count:number)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}}}};
};
export async function verifyLegacyOwner(db:OwnerAuthClient,authorization:string|null,signal:AbortSignal):Promise<boolean>{
  if(!authorization||authorization.length>16400||!/^Bearer [^\s]+$/i.test(authorization)||signal.aborted)return false;
  try{
    const token=authorization.slice(7);const {data,error}=await db.auth.getUser(token);
    if(error||!data.user||data.user.is_anonymous===true||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.user.id)||signal.aborted)return false;
    const result=await db.from('profiles').select('user_id,role,active,archived_at').eq('user_id',data.user.id).limit(2).abortSignal(signal);
    if(result.error||!Array.isArray(result.data)||result.data.length!==1||signal.aborted)return false;
    const profile=result.data[0];return profile?.user_id===data.user.id&&profile.role==='owner'&&profile.active===true&&profile.archived_at===null;
  }catch{return false;}
}
