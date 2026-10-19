import {installationAddress,matchesInstallation,validInstallation,type Installation} from './importedAddressContract.ts';
type Row=Record<string,any>;
const canonical=(v:any):string=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
export type SourceEquipmentAddressEstimate={contract:'COS_SOURCE_EQUIPMENT_ADDRESS_ESTIMATE_V1';recordId:string;productId:string;unitNumber:string;customer:string;sourceSha256:string;payloadSha256:string;sourceAddress:Record<string,string>;uploadRecordSha256:string;receiptId:string;address:string;addressSha256:string;latitude:number;longitude:number;matchedAddress:string;geocodedAt:string;provider:'us_census_address_range'|'geocodio';confidence:'address_range_interpolation'|'automatic_address_estimate';accuracyType:string;accuracy:number|null;matchType:string|null;benchmark:string|null;verified:false;liveGps:false};
export type SourceEquipmentEstimateEnvelope={contract:'COS_SOURCE_EQUIPMENT_ESTIMATES_V1';sourceSha256:string;payloadSha256:string;items:SourceEquipmentAddressEstimate[]};
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const product=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const safe=(v:unknown,max=600):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const empty=(v:unknown)=>Array.isArray(v)&&v.length===0;
const addressKeys=['street','city','state','zip'];
function address(v:unknown):Record<string,string>|null{if(!object(v)||Object.keys(v).length!==4||addressKeys.some(k=>typeof v[k]!=='string'||v[k].length>600))return null;return Object.fromEntries(addressKeys.map(k=>[k,v[k]]));}
const sameAddress=(a:unknown,b:unknown)=>address(a)!==null&&address(b)!==null&&JSON.stringify(address(a))===JSON.stringify(address(b));
function installation(v:unknown):Installation|null{const a=address(v);if(!a)return null;const p={street:a.street.trim().replace(/\s+/g,' '),city:a.city.trim().replace(/\s+/g,' '),state:a.state.trim().toUpperCase(),zip:a.zip.trim()};return p.city&&p.zip&&validInstallation(p)?p:null;}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
const normalize=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
function currentRecord(r:Row){return object(r)&&r.kind==='source_equipment'&&['owner_supplied_mhelp_export','mhelpdesk_api'].includes(r.source)&&r.placement==='field'&&r.lifecycle==='active'&&r.active===true&&r.unitId===null&&r.unit===null&&empty(r.representedUnitIds)&&(!r.candidateUnitIds||empty(r.candidateUnitIds))&&r.reviewReason===null&&Array.isArray(r.productIds)&&r.productIds.length===1&&product(r.productIds[0])&&r.id==='mhelp_product:'+r.productIds[0]&&Array.isArray(r.sourceRecordIds)&&r.sourceRecordIds.length===1&&r.sourceRecordIds[0]===r.id&&safe(r.unitNumber,250)&&safe(r.customer,512)&&installation(r.sourceAddress)!==null;}
function receipt(v:unknown):v is Row&{sourceSha256:string;payloadSha256:string}{return object(v)&&hash(v.sourceSha256)&&hash(v.payloadSha256);}
function observed(value:unknown,now:number){if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now)return false;const m=/^(\d{4})-(\d\d)-(\d\d)T/.exec(value);if(!m)return false;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()+1===+m[2]&&d.getUTCDate()===+m[3];}
function validPoint(r:Row,p:Installation,now:number){
 if(r.status!==undefined&&r.status!=='success'||r.verified!==false||r.liveGps!==false||typeof r.latitude!=='number'||typeof r.longitude!=='number'||!Number.isFinite(r.latitude)||!Number.isFinite(r.longitude)||Math.abs(r.latitude)>90||Math.abs(r.longitude)>180||r.latitude===0&&r.longitude===0||!safe(r.matchedAddress)||!matchesInstallation(p,r.matchedAddress)||!observed(r.geocodedAt,now))return false;
 if(r.provider==='us_census_address_range')return r.benchmark==='Public_AR_Current'&&r.accuracyType==='range_interpolation';
 return r.provider==='geocodio'&&['rooftop','range_interpolation'].includes(r.accuracyType)&&typeof r.accuracy==='number'&&Number.isFinite(r.accuracy)&&r.accuracy>=0.9&&r.accuracy<=1&&[null,'building_centroid','parcel_centroid'].includes(r.matchType??null)&&(r.accuracyType!=='range_interpolation'||r.matchType==null);
}
/** A source record can have an address estimate without becoming a COS unit or a health identity. */
export async function checkedSourceEquipmentEstimate(record:unknown,envelope:unknown,receiptBinding:unknown,now=Date.now()):Promise<SourceEquipmentAddressEstimate|null>{
 if(!object(record)||!currentRecord(record)||!object(envelope)||envelope.contract!=='COS_SOURCE_EQUIPMENT_ESTIMATES_V1'||!receipt(receiptBinding)||envelope.sourceSha256!==receiptBinding.sourceSha256||envelope.payloadSha256!==receiptBinding.payloadSha256||!Array.isArray(envelope.items)||envelope.items.length>1001)return null;
 const matches=envelope.items.filter(r=>object(r)&&(r.recordId===record.id||r.productId===record.productIds[0]));if(matches.length!==1)return null;const r=matches[0],p=installation(record.sourceAddress)!;
 if(r.contract!=='COS_SOURCE_EQUIPMENT_ADDRESS_ESTIMATE_V1'||r.recordId!==record.id||r.productId!==record.productIds[0]||r.unitNumber!==record.unitNumber||r.customer!==record.customer||r.sourceSha256!==receiptBinding.sourceSha256||r.payloadSha256!==receiptBinding.payloadSha256||!hash(r.uploadRecordSha256)||!uuid(r.receiptId)||!sameAddress(r.sourceAddress,record.sourceAddress)||r.address!==installationAddress(p)||!hash(r.addressSha256)||r.addressSha256!==await digest(normalize(r.address))||!validPoint(r,p,now)||r.confidence!==(r.provider==='geocodio'?'automatic_address_estimate':'address_range_interpolation'))return null;
 return r as SourceEquipmentAddressEstimate;
}
/** Prepare unique, complete addresses only from the authoritative combined roster and exact reviewed upload. */
export async function sourceEquipmentAddressCandidates(snapshot:Row,upload:unknown){
 if(!object(upload)||!['COS_MHELP_UPLOAD_V1','COS_MHELP_API_V1'].includes(upload.contract)||upload.reviewed!==true||!receipt(upload)||!Array.isArray(upload.records)||!object(snapshot.uploadInventory)||snapshot.uploadInventory.sourceSha256!==upload.sourceSha256||!Array.isArray(snapshot.fleetRoster?.items))return [];
 const candidates=[];const seen=new Set<string>();
 for(const r of snapshot.fleetRoster.items){if(!object(r)||!currentRecord(r))continue;if(seen.has(r.id))return [];seen.add(r.id);
  const rows=upload.records.filter((u:Row)=>u.productId===r.productIds[0]);if(rows.length!==1)continue;const u=rows[0];
  // Any proven/candidate binding or placement hold keeps its own identity-review path.
  if(u.placement!=='FIELD'||u.lifecycle!=='UNFLAGGED'||u.binding!==null||u.placementHeld===true||u.unitNumber!==r.unitNumber||u.customer!==r.customer||!sameAddress(u.sourceAddress,r.sourceAddress))continue;
  const p=installation(r.sourceAddress)!,full=installationAddress(p);candidates.push({record:r,uploadRecord:u,address:normalize(full),addressSha256:await digest(normalize(full)),installation:p});
 }
 return candidates;
}
/** Reviewed receipt reads are side-effect-free and atomically bound to the active immutable upload. */
export async function projectSourceEquipmentAddressEstimates(snapshot:Row,upload:unknown,cacheRows:unknown,activeHead:unknown,now=Date.now()){
 if(!receipt(upload)||!receipt(activeHead)||upload.sourceSha256!==activeHead.sourceSha256||upload.payloadSha256!==activeHead.payloadSha256||!Array.isArray(cacheRows)||cacheRows.length>1001)return snapshot;
 const candidates=await sourceEquipmentAddressCandidates(snapshot,upload);const items:SourceEquipmentAddressEstimate[]=[];
 for(const c of candidates){const hits=cacheRows.filter(r=>object(r)&&r.productId===c.record.productIds[0]&&r.sourceSha256===upload.sourceSha256&&r.payloadSha256===upload.payloadSha256&&hash(r.uploadRecordSha256)&&hash(r.linkageGraphSha256)&&uuid(r.receiptId)&&object(r.uploadRecord)&&canonical(r.uploadRecord)===canonical(c.uploadRecord)&&r.address===c.address&&r.addressSha256===c.addressSha256);if(hits.length!==1)continue;const geo=hits[0];if(geo.contract!=='COS_SAVED_ADDRESS_CACHE_V1'||geo.status!=='success'||!validPoint(geo,c.installation,now))continue;
  items.push({contract:'COS_SOURCE_EQUIPMENT_ADDRESS_ESTIMATE_V1',recordId:c.record.id,productId:c.record.productIds[0],unitNumber:c.record.unitNumber,customer:c.record.customer,sourceSha256:upload.sourceSha256,payloadSha256:upload.payloadSha256,sourceAddress:address(c.record.sourceAddress)!,uploadRecordSha256:geo.uploadRecordSha256,receiptId:geo.receiptId,address:installationAddress(c.installation),addressSha256:c.addressSha256,latitude:geo.latitude,longitude:geo.longitude,matchedAddress:geo.matchedAddress,geocodedAt:geo.geocodedAt,provider:geo.provider,confidence:geo.provider==='geocodio'?'automatic_address_estimate':'address_range_interpolation',accuracyType:geo.accuracyType,accuracy:geo.accuracy??null,matchType:geo.matchType??null,benchmark:geo.benchmark??null,verified:false,liveGps:false});
 }
 return {...snapshot,uploadInventory:{...snapshot.uploadInventory,payloadSha256:upload.payloadSha256},sourceEquipmentEstimates:{contract:'COS_SOURCE_EQUIPMENT_ESTIMATES_V1',sourceSha256:upload.sourceSha256,payloadSha256:upload.payloadSha256,items}};
}
