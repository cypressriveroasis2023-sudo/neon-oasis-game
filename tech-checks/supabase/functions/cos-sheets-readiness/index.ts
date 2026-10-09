import {SheetsConnectionError} from '../cos-operations-pages/googleSheets.ts';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createSheetsReadiness(options:{authenticate:(req:Request)=>Promise<boolean>|boolean;sheets:(path:string,method:string,body:unknown)=>Promise<unknown>}){
 return async(req:Request)=>{
  try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
  let action:string;
  try{
   if(req.method!=='POST'||new URL(req.url).search||!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')??''))throw Error();
   const reader=req.body?.getReader();if(!reader)throw Error();let length=0;const chunks:Uint8Array[]=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096)throw Error();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
   const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!['status','check'].includes(body.action))throw Error();action=body.action;
  }catch{return reply({error:'Invalid Sheets readiness request'},400);}
  try{
   const v=await options.sheets('/api/unit-tracker/sheets/'+action,action==='status'?'GET':'POST',{});
   return reply(v);
  }catch(cause){return reply({error:cause instanceof SheetsConnectionError?cause.message:'Sheets readiness is unavailable'},cause instanceof SheetsConnectionError?cause.status:503);}
 };
}
