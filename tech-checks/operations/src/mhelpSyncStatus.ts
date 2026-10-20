type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const time=(v:unknown,now:number):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Only saved source evidence can establish inventory freshness. Configuration
 * and a successful browser read do not establish current vendor access. */
export function mhelpSyncStatus(value:unknown,now=Date.now()){
 const unknown={label:'Not yet verified',connection:'Not yet verified',lastSuccess:null as string|null,retryAt:null as string|null,field:null as number|null,shop:null as number|null};
 if(!row(value))return unknown;
 const sync=row(value.mhelpPlacementSync)?value.mhelpPlacementSync:{},source=value.uploadInventory;
 const retryAt=typeof sync.nextReadAt==='string'&&Number.isFinite(Date.parse(sync.nextReadAt))&&Date.parse(sync.nextReadAt)>now?sync.nextReadAt:null;
 if(!row(source)||source.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||!row(source.summary))return {...unknown,retryAt};
 const totals=source.summary;
 if(!count(totals.fieldRecords)||!count(totals.shopRecords)||!count(totals.totalRecords)||totals.fieldRecords+totals.shopRecords!==totals.totalRecords)return {...unknown,retryAt};
 const api=source.source==='mhelpdesk_api';
 // Uploaded-file timestamps are never presented as successful API updates.
 const lastSuccess=api&&time(source.lastApiReadAt,now)?source.lastApiReadAt:null;
 const error=typeof sync.errorCode==='string'&&sync.errorCode.length>0;
 return {label:retryAt?'Waiting for mHelpDesk':error?'Not yet verified':lastSuccess&&now-Date.parse(lastSuccess)<=30*60000?'Up to date':'Not yet verified',
  connection:lastSuccess?'Access verified at last update':'Not yet verified',lastSuccess,retryAt,field:totals.fieldRecords,shop:totals.shopRecords};
}
