import {createSheetsReadiness} from './index.ts';
import {createSheetsConnection} from '../cos-operations-pages/googleSheets.ts';
import {signSheetsAssertion} from '../cos-operations-pages/googleSheetsRuntime.ts';
const sheets=createSheetsConnection({getServiceAccountJson:()=>Deno.env.get('COS_GOOGLE_SERVICE_ACCOUNT_JSON'),signAssertion:signSheetsAssertion});
Deno.serve(createSheetsReadiness({sheets,authenticate:async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://tughscoxralhofrckvxy.supabase.co')return false;
 const candidate=req.headers.get('x-camera-cron-secret');
 if(!candidate||candidate.length>1024||/\s/.test(candidate))return false;
 // Reuse the existing verifier, without copying its secret to another project.
 const response=await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'authenticate'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok){await response.body?.cancel();return false;}
 const reader=response.body?.getReader();if(!reader)return false;
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>128)return false;chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&Object.keys(v).length===1&&v.authenticated===true;
}}));
