type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const time=(v:unknown,now:number):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Saved source time, current auth evidence and dispatcher eligibility are
 * independent clocks. Opening this view performs no vendor request. */
export function mhelpSyncStatus(value:unknown,now=Date.now()){
 const unknown={label:'Not yet verified',connection:'Not yet verified',lastSuccess:null as string|null,retryAt:null as string|null,field:null as number|null,shop:null as number|null,exceptions:null as number|null,renewalCheckFailed:false,paused:false,reconnectRequired:false};
 if(!row(value))return unknown;
 const sync=row(value.mhelpPlacementSync)?value.mhelpPlacementSync:{},source=value.uploadInventory;
 const status=row(sync.reliability)&&sync.reliability.contract==='COS_MHELP_RELIABILITY_STATUS_V1'?sync.reliability:null;
 const auth=status&&row(status.auth)?status.auth:null,inventory=status&&row(status.inventory)?status.inventory:null;
 const paused=inventory?.paused===true,reconnectRequired=auth?.state==='reconnect_required';
 const eligible=inventory?.nextEligibleAt??sync.nextReadAt;
 const retryAt=!paused&&typeof eligible==='string'&&Number.isFinite(Date.parse(eligible))&&Date.parse(eligible)>now?eligible:null;
 const connected=auth?.state==='verified'&&time(auth.verifiedAt,now);
 const base={...unknown,paused,reconnectRequired,retryAt,renewalCheckFailed:auth?.renewalCheckFailed===true,connection:reconnectRequired?'Reconnect required':connected?'Connected':'Not yet verified',
  label:reconnectRequired?'Reconnect required':paused?'Automatic updates paused':retryAt?'Waiting for mHelpDesk':inventory?.updating===true?'Updating':'Not yet verified'};
 if(!row(source)||source.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||!row(source.summary))return base;
 const totals=source.summary;
 if(!count(totals.fieldRecords)||!count(totals.shopRecords)||!count(totals.totalRecords)||totals.fieldRecords+totals.shopRecords!==totals.totalRecords)return base;
 // File-upload and browser-read timestamps cannot establish API freshness.
 const lastSuccess=source.source==='mhelpdesk_api'&&time(source.lastApiReadAt,now)?source.lastApiReadAt:null;
 const error=typeof sync.errorCode==='string'&&sync.errorCode.length>0||inventory?.failed===true;
 const fresh=lastSuccess&&now-Date.parse(lastSuccess)<=30*60000;
 return {...base,label:reconnectRequired||paused||retryAt||inventory?.updating===true?base.label:error?'Not yet verified':fresh?'Up to date':'Not yet verified',
  connection:base.connection==='Not yet verified'&&lastSuccess?'Access verified at last update':base.connection,lastSuccess,field:totals.fieldRecords,shop:totals.shopRecords,
  exceptions:count(totals.heldRecords)&&totals.heldRecords<=totals.totalRecords?totals.heldRecords:null};
}
