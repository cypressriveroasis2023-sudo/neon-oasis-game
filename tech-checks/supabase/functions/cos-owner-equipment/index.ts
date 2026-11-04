import {createOwnerHandler} from './runtime.ts';
import {publicIp} from '../../../operations/src/ownerEquipmentCore.ts';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rpc=async(name:string,args:Record<string,unknown>,signal:AbortSignal)=>{
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),signal,redirect:'error',cache:'no-store'});
 const v=await r.json();if(!r.ok)throw Object.assign(Error(v.message||'Database operation failed.'),{code:v.code});return v;
};
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
let token:{value:string;until:number}|null=null;
async function sheetToken(signal:AbortSignal){
 if(token&&token.until>Date.now()+60000)return token.value;
 let account;try{account=JSON.parse(Deno.env.get('COS_GOOGLE_SERVICE_ACCOUNT_JSON')||'');}catch{throw Error('2027 tracker credentials are unavailable.');}
 if(!account.client_email||!account.private_key)throw Error('2027 tracker credentials are incomplete.');
 const encode=(v:unknown)=>b64(new TextEncoder().encode(JSON.stringify(v))),iat=Math.floor(Date.now()/1000);
 const data=encode({alg:'RS256',typ:'JWT',kid:account.private_key_id})+'.'+encode({iss:account.client_email,aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600,scope:'https://www.googleapis.com/auth/spreadsheets.readonly'});
 const der=Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0));
 const signing=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signing,new TextEncoder().encode(data)));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:data+'.'+b64(signature)}),signal,redirect:'error'});
 const v=await r.json();if(!r.ok||typeof v.access_token!=='string'||v.token_type!=='Bearer')throw Error('2027 tracker authorization failed.');
 token={value:v.access_token,until:Date.now()+Math.min(Number(v.expires_in)||0,3300)*1000};return token.value;
}
async function tracker(parent:AbortSignal){
 const signal=AbortSignal.any([parent,AbortSignal.timeout(20000)]),access=await sheetToken(signal);
 const base='https://sheets.googleapis.com/v4/spreadsheets/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
 const get=async(url:string,max=2200000)=>{const r=await fetch(url,{headers:{Authorization:'Bearer '+access},signal,redirect:'error',cache:'no-store'});if(!r.ok||Number(r.headers.get('content-length'))>max)throw Error('2027 tracker read failed.');const text=await r.text();if(text.length>max)throw Error('2027 tracker exceeds its complete-read limit.');return JSON.parse(text);};
 const meta=await get(base+'?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))',250000);
 const sheets=meta.sheets?.filter((s:any)=>s.properties?.sheetId===1132540236),s=sheets?.[0]?.properties;
 if(meta.properties?.title!=='2027 UNIT TRACKER'||sheets?.length!==1||s.title!=='UNIT OVERVIEW'||!Number.isSafeInteger(s.gridProperties?.rowCount)||s.gridProperties.rowCount>12000||s.gridProperties.rowCount<2||s.gridProperties.columnCount<19)throw Error('The complete 2027 tracker structure could not be verified.');
 const result=await get(base+'/values/'+encodeURIComponent("'UNIT OVERVIEW'!A1:S"+s.gridProperties.rowCount)+'?valueRenderOption=FORMATTED_VALUE');
 const a=result.values;if(!Array.isArray(a)||a[0]?.[0]!=='EQUIPMENT TYPE'||!/^IP(?: ADDRESS)?$/i.test(a[0]?.[7]||'')||a[0]?.[14]!=='MHELP EQUIPMENT ID')throw Error('2027 Product ID and IP columns need review.');
 const rows=a.slice(1).filter((r:any[])=>r.some(v=>String(v).trim()!=='' )).map((r:any[])=>({productId:/^[1-9][0-9]{0,14}$/.test(String(r[14]||''))?String(r[14]):null,ip:String(r[7]||'').trim()||null}));
 const ids=rows.flatMap((r:any)=>r.productId?[r.productId]:[]);if(new Set(ids).size!==ids.length)throw Error('Duplicate Product IDs prevent a safe endpoint check.');
 return {rows,observedAt:new Date().toISOString()};
}
async function probe(host:string,port:number,signal:AbortSignal){
 if(!publicIp(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('Unsupported target.');
 const started=Date.now(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),2200);let conn:Deno.Conn|undefined;
 try{conn=await Deno.connect({hostname:host,port,signal:AbortSignal.any([signal,abort.signal])});return {outcome:'responded',latencyMs:Date.now()-started};}
 catch(e){if(signal.aborted)throw e;const message=e instanceof Error?e.message:'';if(abort.signal.aborted||/Connection refused \(os error 111\)|Connection timed out \(os error 110\)/.test(message))return {outcome:'no_response',latencyMs:null};throw Error('The network check failed technically; no Offline reading was created.');}
 finally{clearTimeout(timer);try{conn?.close();}catch{}}
}
Deno.serve(createOwnerHandler({rpc,fetch,tracker,probe}));
