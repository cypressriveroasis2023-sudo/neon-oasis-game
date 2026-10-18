import {compareAddress,parseAddress} from '../../supabase/functions/camera-field-geocode/censusAddress';
/** Strict client boundary for MHelpDesk address pins.
 * Field/Shop comes from the current imported Product ID, NEVER GPS status or
 * a camera/provider identity. Address pin is not installation verification.
 */
export type MhelpAddressMapPin={
  id:string;productId:string;unitNumber:string;customer:string;category:string;
  address:string;matchedAddress:string;point:[number,number];provider:string;geocodedAt:string;lookupAddress:string;lifecycle:string;placementHeld:boolean;
  state:'matched'|'address_review';verified:false;liveGps:false;
};
export type MhelpAddressMapReview={
  id:string;productId:string;unitNumber:string;customer:string;category:string;
  address:string;reason:string;lifecycle:string;placementHeld:boolean;state:'no_match'|'invalid_address';
};
export type MhelpAddressMapResult={
  pins:MhelpAddressMapPin[];reviews:MhelpAddressMapReview[];
  sourceSha256:string;payloadSha256:string;
  totalField:number;matched:number;addressReview:number;unlocated:number;
};
type Obj=Record<string,unknown>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=600):v is string=>typeof v==='string'&&v.length<=max&& !/[\x00-\x1f\x7f<>]/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const mhelpAddressProviderLabel=(provider:string):string=>({
 us_census_address_range:'US Census address range',
 geocodio:'Geocodio saved address result',
 municipal_address_point:'Municipal address point',
 public_site_reference:'Public project / property site reference · approximate',
}[provider]||'Unknown address provider');
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const point=(lat:unknown,lon:unknown):lat is number=>typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
const locationDate=(v:unknown,now:number)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
const formatAddress=(v:unknown):string=>{
 if(!object(v)||['street','city','state','zip'].some(k=>!text(v[k],300)))return '';
 const street=(v.street as string).trim(),city=(v.city as string).trim(),
   state=(v.state as string).trim(),zip=(v.zip as string).trim();
 return [street,city,[state,zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
};
const validState=(s:unknown):s is MhelpAddressMapPin['state']|'no_match'|'invalid_address'=>
 ['matched','address_review','no_match','invalid_address'].includes(String(s));
/** Every accepted file supplies its own complete Field/Shop membership proof. */
export function readMhelpAddressMapPins(raw:unknown,head:unknown,now=Date.now()):MhelpAddressMapResult|null{
 if(raw===undefined||raw===null)return null;
 if(!object(raw)||!object(head)||raw.contract!=='COS_MHELP_CENSUS_ADDRESS_MAP_V1'
  ||!hash(raw.sourceSha256)||!hash(raw.payloadSha256)
  ||raw.sourceSha256!==head.sourceSha256||raw.payloadSha256!==head.payloadSha256
  ||raw.verifiedGps!==false||raw.liveGps!==false
  ||raw.confidence!=='mhelpdesk_customer_address_reference_only'
  ||!Array.isArray(head.records)||head.records.length<1||head.records.length>10000
  ||!Array.isArray(raw.items))return null;
 if(head.records.some((r:unknown)=>!object(r)||!id(r.productId)||!['FIELD','SHOP'].includes(String(r.placement)))
  ||new Set(head.records.map((r:Obj)=>r.productId)).size!==head.records.length)return null;
 const expected=new Set(head.records.filter((r:unknown)=>object(r)&&r.placement==='FIELD').map((r:Obj)=>r.productId));
 const shops=head.records.length-expected.size;
 if(raw.totalProducts!==head.records.length||raw.fieldProducts!==expected.size||raw.shopProducts!==shops
  ||raw.items.length!==expected.size||head.recordCount!==undefined&&head.recordCount!==head.records.length)return null;
 const ids=new Set<string>(),pins:MhelpAddressMapPin[]=[],reviews:MhelpAddressMapReview[]=[];
 for(const item of raw.items){
  if(!object(item)||!id(item.productId)||!expected.has(item.productId)||ids.has(item.productId)||!hash(item.sourceRowSha256)
   ||!text(item.unitNumber,250)||!(item.unitNumber as string).trim()
   ||!text(item.customer,512)||!text(item.category,250)
   ||item.placement!=='FIELD'||!['UNFLAGGED','DO_NOT_USE','MISSING','RETIRED','DECOMMISSIONED'].includes(String(item.lifecycle))
   ||typeof item.placementHeld!=='boolean'||!validState(item.status)
   ||!text(item.reason,600)&&item.reason!==null
   ||!text(item.matchedAddress,600)&&item.matchedAddress!==null
   ||item.verified!==false||item.liveGps!==false
   ||item.confidence!=='mhelpdesk_address_census_range_unverified'
   ||!['us_census_address_range','geocodio','municipal_address_point','public_site_reference'].includes(String(item.geocodeSource))
   ||item.sourceAddress===null||!object(item.sourceAddress))return null;
  ids.add(item.productId);
  const address=formatAddress(item.sourceAddress),state=item.status;
  const common={id:'mhelp_product:'+item.productId,productId:item.productId as string,
   unitNumber:item.unitNumber as string,customer:item.customer as string,
   category:item.category as string,address,lifecycle:item.lifecycle as string,placementHeld:item.placementHeld as boolean};
  if(state==='matched'||state==='address_review'){
   if(!point(item.latitude,item.longitude)||!locationDate(item.geocodedAt,now)
     ||!text(item.matchedAddress,600)||!(item.matchedAddress as string).trim())return null;
   const sourceParts=parseAddress(address),matchedParts=parseAddress(item.matchedAddress),
     discrepancy=sourceParts&&matchedParts&&!compareAddress(sourceParts,matchedParts);
   pins.push({...common,state:discrepancy||item.geocodeSource==='public_site_reference'?'address_review':state,provider:String(item.geocodeSource),geocodedAt:String(item.geocodedAt),lookupAddress:typeof item.lookupAddress==='string'?item.lookupAddress:'',point:[item.latitude,item.longitude as number],matchedAddress:item.matchedAddress as string,verified:false,liveGps:false});
  }else{
   if(item.latitude!==null||item.longitude!==null||item.matchedAddress!==null)return null;
   reviews.push({...common,state,reason:String(item.reason|| (state==='no_match'?'The Census did not locate this address.':'Service address needs correction.'))});
  }
 }
 if(ids.size!==expected.size||pins.length+reviews.length!==expected.size)return null;
 return {pins,reviews,sourceSha256:raw.sourceSha256 as string,payloadSha256:raw.payloadSha256 as string,totalField:expected.size,
  matched:pins.filter(p=>p.state==='matched').length,addressReview:pins.filter(p=>p.state==='address_review').length,
  unlocated:reviews.length};
}
