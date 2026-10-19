// Additive runtime: preserves the existing Operations/auth/provider deployments.
// Business writes are controlled by the private database lease and enabled flag.
import {createOperationalSheetSyncRuntime} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operational-sheets-sync/runtime.ts';
import {signSheetsAssertion} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operations-pages/googleSheetsRuntime.ts';
import {readSheetsJson} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operations-pages/googleSheets.ts';
import {normalizeGoogleSheetWire} from './wire.ts';
const BOOK_URL='https://sheets.googleapis.com/v4/spreadsheets/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
const transport:typeof fetch=async(input,init)=>{
 const result=await fetch(input,init);
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(result.ok&&url.startsWith(BOOK_URL)&&(!init?.method||init.method==='GET')){
  const body=await readSheetsJson(result,9*1024*1024,init?.signal??AbortSignal.timeout(35000));
  return new Response(JSON.stringify(normalizeGoogleSheetWire(body)),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 return result;
};
Deno.serve(createOperationalSheetSyncRuntime({
 getEnv:name=>name==='COS_OPERATIONAL_SHEETS_WORKER_ENABLED'?'true':Deno.env.get(name),
 fetch:transport,signAssertion:signSheetsAssertion
}));
