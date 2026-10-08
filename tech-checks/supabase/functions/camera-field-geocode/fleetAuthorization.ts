/** Existing legacy profiles are authoritative here; native roles are rechecked by the native bridge. */
const APPROVED_IT_IDS=new Set(['4f7044b5-86b6-411f-8898-39bb64b4ddbc','b7cc3cbf-d11e-4d4a-9742-c07701857911']);
export function createFleetVerifier(request:(path:string,init:RequestInit)=>Promise<any>,service:string){
 return async(authorization:string):Promise<boolean>=>{
  if(!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)return false;
  try{
   const user=await request('/auth/v1/user',{headers:{apikey:service,Authorization:authorization}});
   if(typeof user?.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user.id))return false;
   const profiles=await request('/rest/v1/profiles?select=user_id,role,active,archived_at&user_id=eq.'+user.id+'&limit=2',{headers:{apikey:service,Authorization:'Bearer '+service}});
   if(!Array.isArray(profiles)||profiles.length!==1)return false;
   const p=profiles[0];
   return p.user_id===user.id&&p.active===true&&p.archived_at===null&&
     (p.role==='owner'||(p.role==='it'&&APPROVED_IT_IDS.has(user.id)));
  }catch{return false;}
 };
}
