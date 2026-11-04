/** Owner edits are a separate, durable Product-ID authority. Raw mHelp/Sheets and provider camera identities remain unchanged. */
export const OWNER_CONTRACT='COS_OWNER_EQUIPMENT_V1';
export const fields=['placement','customer','site','address','publicIp','ports','monitoringEnabled','latitude','longitude'] as const;
export function publicIp(value:unknown):boolean{
 if(typeof value!=='string'||!/^\d+\.\d+\.\d+\.\d+$/.test(value))return false;
 const p=value.split('.'),[a,b,c]=p.map(Number);
 if(p.some(v=>String(Number(v))!==v||Number(v)>255))return false;
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
export function validateSettings(v:any){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...fields].sort().join('|'))throw Error('Unsupported equipment settings.');
 if(!['FIELD','SHOP'].includes(v.placement))throw Error('Choose Field or Shop.');
 for(const key of ['customer','site','address','publicIp'])if(typeof v[key]!=='string'||v[key]!==v[key].trim()||v[key].length>(key==='address'?600:250)||/[\x00-\x1f\x7f<>]/.test(v[key]))throw Error('Use plain text for '+key+'.');
 if(v.placement==='FIELD'&&(!v.customer||!v.address))throw Error('Field equipment needs a customer and service address. GPS is optional.');
 if(v.publicIp&&!publicIp(v.publicIp))throw Error('Enter a public IPv4 address, without a URL or port.');
 if(!Array.isArray(v.ports)||v.ports.length>32||v.ports.some((p:any)=>!Number.isInteger(p)||p<1||p>65535)||new Set(v.ports).size!==v.ports.length)throw Error('Use distinct service ports between 1 and 65535.');
 if(typeof v.monitoringEnabled!=='boolean'||v.monitoringEnabled&&(!v.publicIp||!v.ports.length))throw Error('Monitoring needs a saved public IP and at least one service port.');
 if((v.latitude===null)!==(v.longitude===null)||v.latitude!==null&&(!Number.isFinite(v.latitude)||!Number.isFinite(v.longitude)||Math.abs(v.latitude)>90||Math.abs(v.longitude)>180))throw Error('Enter both latitude and longitude, or leave both blank.');
 return {...v,ports:[...v.ports].sort((a:number,b:number)=>a-b)};
}
export function checkedControl(c:any,pid?:string){
 if(!c||c.contract!==OWNER_CONTRACT||!/^[1-9][0-9]{0,14}$/.test(c.productId)||pid&&c.productId!==pid||!Number.isSafeInteger(c.revision)||c.revision<1||!Number.isSafeInteger(c.connectionRevision)||c.connectionRevision<1||typeof c.active!=='boolean'||!Number.isFinite(Date.parse(c.updatedAt)))return null;
 try{validateSettings(c.settings);return c;}catch{return null;}
}
export function ownerConnection(c:any,now=Date.now()){
 const value=checkedControl(c);if(!value?.active)return null;
 const s=value.settings,check=value.lastCompleted;
 const reason=!s.monitoringEnabled?'Monitoring is disabled. Save settings with monitoring enabled to check this unit.':!s.publicIp||!s.ports.length?'Connection setup is incomplete. Save an IP and service ports.':!check?'No completed check has been saved for this configuration.':check.connectionRevision!==value.connectionRevision?'The IP or port setup changed. Run a new connection check.':!Number.isFinite(Date.parse(check.checkedAt))||Date.parse(check.checkedAt)>now||now-Date.parse(check.checkedAt)>20*60*1000?'Last completed reading is stale; the saved setup has not been erased.':null;
 if(reason)return {status:'unknown',reason,checkedAt:null,lastCompleted:check||null};
 if(!['online','offline'].includes(check.status)||check.publicIp!==s.publicIp||JSON.stringify(check.ports)!==JSON.stringify(s.ports)||!Array.isArray(check.outcomes)||check.outcomes.length!==s.ports.length||new Set(check.outcomes.map((x:any)=>x.port)).size!==s.ports.length||check.outcomes.some((x:any)=>!s.ports.includes(x.port)||!['responded','no_response'].includes(x.outcome))||(check.status==='online')!==check.outcomes.some((x:any)=>x.outcome==='responded'))return {status:'unknown',reason:'Saved connection evidence is incomplete.',checkedAt:null,lastCompleted:check};
 return {status:check.status,checkedAt:check.checkedAt,lastCompleted:check,reason:'Owner-configured Product-ID target: '+(check.status==='online'?'a service port responded.':'all configured service ports completed without a response.')+' This is connection status, not video or recording verification.'};
}
function recount(roster:any){const a=roster.items;return {...roster,summary:{...roster.summary,totalRecords:a.length,activeRecords:a.filter((r:any)=>r.active).length,field:a.filter((r:any)=>r.active&&r.placement==='field').length,shop:a.filter((r:any)=>r.active&&r.placement==='shop').length,review:a.filter((r:any)=>r.active&&r.placement==='unknown').length,excludedLifecycle:a.filter((r:any)=>!r.active).length,sourceOnlyRecords:a.filter((r:any)=>r.kind!=='unit').length,linkedUnitRecords:a.filter((r:any)=>r.kind==='unit').length}};}
/** Source-only records remain source-only: no fabricated native UUID or provider link. */
export function projectOwnerMap(input:any,controls:any[]){
 if(!input?.uploadInventory?.records||!Array.isArray(input.fleetRoster?.items)||!Array.isArray(input.inventoryItems))return input;
 const admitted=new Map<string,any>();
 for(const c of controls){if(!checkedControl(c)||!c.active)continue;const found=input.uploadInventory.records.filter((p:any)=>p.productId===c.productId);if(found.length===1&&found[0].uploadLifecycle==='UNFLAGGED')admitted.set(c.productId,c);}
 if(!admitted.size)return input;
 const map=structuredClone(input),original=map.uploadInventory;
 original.ownerAddressSourceInventory=original.ownerAddressSourceInventory||{sourceSha256:original.sourceSha256,payloadSha256:original.payloadSha256,summary:{totalRecords:original.records.length},records:original.records.map((p:any)=>({productId:p.productId,placement:p.placement}))};
 const units=new Map(map.inventoryItems.map((u:any)=>[u.id,u]));
 for(const p of original.records){const c=admitted.get(p.productId);if(!c)continue;const s=c.settings;
  p.sourceAssignment=p.sourceAssignment||{placement:p.placement,customer:p.customer,sourceAddress:p.sourceAddress};p.placement=s.placement;p.customer=s.customer;p.site=s.site;p.sourceAddress={street:s.address,city:'',state:'',zip:''};p.ownerControl=c;
  const related=map.fleetRoster.items.filter((r:any)=>r.productIds?.includes(p.productId));
  if(related.length!==1||related[0].productIds.length!==1){p.ownerControl={...c,projectionHold:'Multiple inventory representations need a specific identity correction.'};continue;}
  const r=related[0];r.source='owner';r.observedAt=c.updatedAt;r.customer=s.customer||null;r.sourceAddress=p.sourceAddress;r.placement=s.placement.toLowerCase();r.reviewReason='Owner settings saved in COS. mHelp and the 2027 tracker are unchanged.';r.ownerControl=c;delete r.recordedSourcePlacement;
  if(r.kind!=='unit'){r.kind='source_equipment';p.binding={...p.binding,state:'unlinked',placementHeld:false,candidateUnitIds:[],reason:null};}
  else {const u:any=units.get(r.unitId);if(u){u.ownerControl=c;u.placement=s.placement;u.currentLocationType=s.placement.toLowerCase();u.status=s.placement==='FIELD'?'field':'available';u.customer=s.customer;u.site=s.site;u.address=s.address;u.addressSource='owner';u.addressUpdatedAt=c.updatedAt;u.placementSource='owner_product';u.effectivePlacement={contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:s.placement.toLowerCase(),source:'owner_product',freshness:'recorded',observedAt:c.updatedAt};
    if(s.latitude!==null){u.latitude=s.latitude;u.longitude=s.longitude;u.coordinateSource='owner_manual';u.hasUnitGps=false;u.locationVerification='owner_verified';u.gpsRecordedAt=c.updatedAt;u.locationVerifiedAt=c.updatedAt;}
    else if(s.address!==[p.sourceAssignment.sourceAddress?.street,p.sourceAssignment.sourceAddress?.city,p.sourceAssignment.sourceAddress?.state,p.sourceAssignment.sourceAddress?.zip].filter(Boolean).join(', ')){u.latitude=null;u.longitude=null;u.locationVerification='address_changed';u.hasUnitGps=false;}
    r.unit=u;
  }}
 }
 const rec=original.records;original.ownerOverrides=[...admitted.values()];original.mhelpSourceSummary=original.mhelpSourceSummary||{...original.summary};original.summary={...original.summary,fieldRecords:rec.filter((p:any)=>p.placement==='FIELD').length,shopRecords:rec.filter((p:any)=>p.placement==='SHOP').length,unflaggedFieldRecords:rec.filter((p:any)=>p.placement==='FIELD'&&p.uploadLifecycle==='UNFLAGGED').length,unflaggedShopRecords:rec.filter((p:any)=>p.placement==='SHOP'&&p.uploadLifecycle==='UNFLAGGED').length};
 map.items=map.inventoryItems.filter((u:any)=>(u.effectivePlacement?.state||String(u.placement||u.currentLocationType).toLowerCase())==='field'&&u.activeInventoryEligible!==false);
 map.summary={...map.summary,fieldUnits:map.items.length,mappedUnits:map.items.filter((u:any)=>u.latitude!=null&&u.longitude!=null).length,unitGps:map.items.filter((u:any)=>u.hasUnitGps).length,missingGps:map.items.filter((u:any)=>u.latitude==null||u.longitude==null).length};
 map.fleetRoster=recount(map.fleetRoster);map.ownerOverrides=[...admitted.values()];
 if(map.manualPlacementOverrides?.items)map.manualPlacementOverrides.items=map.manualPlacementOverrides.items.filter((m:any)=>!m.sourceBindings?.some((b:any)=>admitted.has(b.productId))&&!map.inventoryItems.some((u:any)=>u.id===m.unitId&&u.ownerControl?.active));
 return map;
}
export function projectOwnerConnections(receipt:any,controls:any[]){
 if(receipt?.contract!=='COS_EXACT_PRODUCT_CONNECTIONS_V2'||!Array.isArray(receipt.items))return receipt;
 const result=structuredClone(receipt);result.ownerOverrides=controls.filter(c=>checkedControl(c)&&c.active&&c.currentSourcePresent!==false);
 for(const c of controls){if(!checkedControl(c)||!c.active||c.currentSourcePresent===false||(c.currentSourceLifecycle??c.sourceLifecycle)!=='UNFLAGGED')continue;result.items=result.items.filter((p:any)=>p.productId!==c.productId);if(c.settings.placement==='FIELD')result.items.push({productId:c.productId,status:'unknown',basis:'tcp_service_port',resourceId:null,checkedAt:null,reason:'Owner-managed target. Its independently saved connection result is displayed on the equipment record.'});}
 return result;
}
/** Validate the original address receipt first. Owner points never become geocoding/GPS evidence. */
export function ownerAddressPins(base:any,head:any){
 if(!base||!Array.isArray(head?.ownerOverrides))return base;
 const result={...base,pins:[...base.pins],reviews:[...base.reviews]};
 for(const c of head.ownerOverrides){if(!checkedControl(c)||!c.active)continue;
  const p=head.records.find((p:any)=>p.productId===c.productId&&p.ownerControl&&!p.ownerControl.projectionHold);if(!p)continue;
  result.pins=result.pins.filter((p:any)=>p.productId!==c.productId);result.reviews=result.reviews.filter((p:any)=>p.productId!==c.productId);
  if(c.settings.placement!=='FIELD')continue;
  const s=c.settings,common={id:'mhelp_product:'+c.productId,productId:c.productId,unitNumber:p.unitNumber,customer:s.customer,category:p.category||'',address:s.address,lifecycle:p.uploadLifecycle,placementHeld:false,ownerManaged:true};
  if(s.latitude!==null)result.pins.push({...common,matchedAddress:s.address,point:[s.latitude,s.longitude],provider:'owner_manual',geocodedAt:c.updatedAt,lookupAddress:s.address,state:'address_review',verified:false,liveGps:false});
  else result.reviews.push({...common,state:'no_match',reason:'Owner address saved. Optional map coordinates have not been set; GPS is not required.'});
 }
 return {...result,totalField:result.pins.length+result.reviews.length,matched:result.pins.filter((p:any)=>p.state==='matched').length,addressReview:result.pins.filter((p:any)=>p.state==='address_review').length,unlocated:result.reviews.length};
}
