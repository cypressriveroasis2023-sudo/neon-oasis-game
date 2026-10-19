// Additive scheduled runtime. Existing Operations/auth/provider deployments remain unchanged.
import {createOperationalSheetSyncRuntime} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operational-sheets-sync/runtime.ts';
import {readOperationalWorkbook} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operational-sheets-sync/googleGrid.ts';
import {signSheetsAssertion} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operations-pages/googleSheetsRuntime.ts';
import {readSheetsJson} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/3aa6aa3e8c2ef44d1e7c658bb2f4d9be43c96ccd/tech-checks/supabase/functions/cos-operations-pages/googleSheets.ts';
import {normalizeGoogleSheetWire} from './wire.ts';
const BOOK_URL='https://sheets.googleapis.com/v4/spreadsheets/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
const VALIDATION_ERRORS=new Set(['Incomplete protected equipment columns','Tracker column range changed','Malformed Google cell range','Malformed Google cell','Wrong tracker workbook','Tracker family layout changed','Incomplete 2027 tracker read','Tracker index changed during read','Tracker Product-ID index headers changed','Formula or rich identity cell in tracker index','Duplicate or changed Product-ID index','Incomplete equipment index','Tracker equipment tab changed during read','Tracker equipment headers changed','Formula or nontext unit identity','Duplicate family and unit label','Unsupported formula or rich operational cell','Unsafe operational values','Not every Product ID has one current equipment row']);
type Row=Record<string,any>;
Deno.serve(async request=>{
 let metadata:Row|null=null,validation:string|null=null;
 const cells:{sheetId:number;row:number;column:number;kind:string}[]=[];
 const transport:typeof fetch=async(input,init)=>{
  const result=await fetch(input,init);
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(result.ok&&url.startsWith(BOOK_URL)&&(!init?.method||init.method==='GET')){
   const body=await readSheetsJson(result,9*1024*1024,init?.signal??AbortSignal.timeout(35000));
   const normalized=normalizeGoogleSheetWire(body) as Row;
   if(!new URL(url).searchParams.has('ranges'))metadata=normalized;
   else if(metadata){
    try{readOperationalWorkbook(metadata,normalized);}catch(cause){
     validation=cause instanceof Error&&VALIDATION_ERRORS.has(cause.message)?cause.message:'Protected workbook validation failed';
     for(const sheet of normalized.sheets??[])for(const grid of sheet.data??[])for(const [index,row] of (grid.rowData??[]).entries()){
      const c=row.values?.[0],v=c?.userEnteredValue;
      if(cells.length<12&&v&&(v.formulaValue!==undefined||v.numberValue!==undefined||v.boolValue!==undefined||c.chipRuns?.length||c.textFormatRuns?.length))
       cells.push({sheetId:sheet.properties.sheetId,row:index+(grid.startRow??0)+1,column:(grid.startColumn??0)+1,kind:v.formulaValue!==undefined?'formula':v.numberValue!==undefined?'number':v.boolValue!==undefined?'boolean':c.chipRuns?.length?'chip':'rich_text'});
     }
    }
   }
   return new Response(JSON.stringify(normalized),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  return result;
 };
 const handler=createOperationalSheetSyncRuntime({getEnv:name=>name==='COS_OPERATIONAL_SHEETS_WORKER_ENABLED'?'true':Deno.env.get(name),fetch:transport,signAssertion:signSheetsAssertion});
 const response=await handler(request);
 if(response.status===503&&validation)return Response.json({...await response.json(),validation,cells},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 return response;
});
