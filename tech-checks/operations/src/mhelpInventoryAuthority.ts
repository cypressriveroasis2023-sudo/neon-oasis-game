/** The mHelpDesk Product-ID inventory is not the combined Fleet representation
 * roster. This is a display-only projection from a server-reviewed complete
 * COS_MHELP_UPLOAD_INVENTORY_V1 receipt; never a network or GPS assertion.
 */
export type MhelpInventoryAuthority={
  total:number;field:number;shop:number;inactive:number;fieldActive:number;
  sourceSha256:string;receivedAt:string;stale:boolean;live?:boolean;
  /** Present only while an Owner-accepted freeze names exactly this census.
   * receivedAt stays the real mHelp read time; a freeze never refreshes it. */
  frozen?:{acceptedAt:string;acceptedBy:string};
};
export const INVENTORY_FREEZE_CONTRACT='COS_INVENTORY_FREEZE_V1';
/** A freeze counts only when it names this exact census and was accepted after
 * that census was read. Anything else is ignored, so the normal staleness rule
 * applies and the inventory is declined exactly as before. */
function acceptedFreeze(value:Record<string,any>,observedAt:string,now:number){
 const f=value.frozen;
 if(!record(f)||f.contract!==INVENTORY_FREEZE_CONTRACT||f.sourceSha256!==value.sourceSha256
  ||typeof f.acceptedAt!=='string'||!Number.isFinite(Date.parse(f.acceptedAt))
  ||Date.parse(f.acceptedAt)>now+60000||Date.parse(f.acceptedAt)<Date.parse(observedAt)
  ||typeof f.acceptedBy!=='string'||!f.acceptedBy.trim()||f.acceptedBy.length>120)return null;
 return {acceptedAt:f.acceptedAt,acceptedBy:f.acceptedBy.trim()};
}
const record=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const product=/^[1-9][0-9]{0,14}$/;
export function readMhelpInventoryAuthority(value:unknown,now=Date.now()):MhelpInventoryAuthority|null{
 if(!record(value)||value.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'
  ||value.countBasis!=='mhelp_product_records_not_unique_physical_units'
  ||typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceSha256)
  ||typeof value.receivedAt!=='string'||!Number.isFinite(Date.parse(value.receivedAt))
  ||!Number.isFinite(now)||Date.parse(value.receivedAt)>now+60000
  ||!record(value.summary)||!Array.isArray(value.records))return null;
 const s=value.summary,records=value.records;
 if(!nonnegative(s.totalRecords)||!nonnegative(s.fieldRecords)||!nonnegative(s.shopRecords)
  ||!nonnegative(s.unflaggedFieldRecords)||!nonnegative(s.doNotUseRecords)||!nonnegative(s.missingRecords)
  ||s.totalRecords!==records.length||s.totalRecords!==s.fieldRecords+s.shopRecords
  ||s.unflaggedFieldRecords>s.fieldRecords||s.doNotUseRecords+s.missingRecords>s.totalRecords)return null;
 const seen=new Set<string>();let field=0,shop=0,fieldActive=0,inactive=0;
 for(const item of records){
  if(!record(item)||typeof item.productId!=='string'||!product.test(item.productId)
   ||seen.has(item.productId)||item.recordId!=='mhelp_product:'+item.productId
   ||!['FIELD','SHOP'].includes(item.placement)
   ||!['UNFLAGGED','DO_NOT_USE','MISSING'].includes(item.uploadLifecycle))return null;
  seen.add(item.productId);
  if(item.placement==='FIELD'){field++;if(item.uploadLifecycle==='UNFLAGGED')fieldActive++;}
  else shop++;
  if(item.uploadLifecycle!=='UNFLAGGED')inactive++;
 }
 if(field!==s.fieldRecords||shop!==s.shopRecords||fieldActive!==s.unflaggedFieldRecords
  ||inactive!==s.doNotUseRecords+s.missingRecords)return null;
 const live=value.source==='mhelpdesk_api';
 const observedAt=live?value.lastApiReadAt:value.receivedAt;
 if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now+60000)return null;
 const frozen=acceptedFreeze(value,observedAt,now);
 return {total:records.length,field,shop,inactive,fieldActive,...(live?{live:true}:{}),
  sourceSha256:value.sourceSha256,receivedAt:observedAt,
  // The saved upload is historical evidence, not proof of a live vendor read.
  // While automatic inventory changes are paused, an Owner-accepted freeze of
  // this exact census keeps it usable; its age is still reported by receivedAt.
  stale:frozen?false:now-Date.parse(observedAt)>(live?45*60*1000:24*60*60*1000),
  ...(frozen?{frozen}:{})};
}

/** The whole mHelp Product-ID census is a headline only on the unfiltered
 * default Field view; a filtered COS map cannot claim the whole 287 units. */
export function showMhelpProductHeadline(filters:{placement?:string;query?:string;family?:string;provider?:string;nearbyId?:string;installationStatus?:string;retired?:boolean},hasRoster:boolean,hasCensus:boolean):boolean{
 return hasRoster&&hasCensus&&filters.placement==='field'&&!String(filters.query||'').trim()
  &&filters.family==='all'&&filters.provider==='all'&&!filters.nearbyId
  &&(!filters.installationStatus||filters.installationStatus==='all')&&filters.retired!==true;
}
