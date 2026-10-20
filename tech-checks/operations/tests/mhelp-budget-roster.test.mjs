import test from 'node:test';import assert from 'node:assert/strict';
import {createInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
import {createMhelpPartnerHandler} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
// Synthetic roster matching only production census dimensions, never production customer data.
const items=Array.from({length:1001},(_,i)=>{const customer=i<714?1+i%4:5+(i-714)%59;return {equipmentId:i+1,portalId:224643,name:'Synthetic '+(i+1),model:null,equipmentTypeId:1,customerId:customer,serviceLocationId:customer<=4?customer:customer<=60?customer+100:customer,IsActive:true,lastUpdateUTC:'2026-10-19T00:00:00Z'};});
const baseline={sourceSha256:'a'.repeat(64),companyCustomerIds:['1','2','3','4'],records:items.map(e=>({productId:String(e.equipmentId),unitNumber:e.name,category:'Ranger',customerId:String(e.customerId),placement:e.customerId<=4?'SHOP':'FIELD',sourceAddress:{street:'',city:'',state:'',zip:''},binding:null}))};
test('96 actual two-pass equipment reads plus 3-hour resource refreshes fit the daily allowance and detect an address-only change',async()=>{
 let clock=Date.parse('2026-10-20T00:00:00Z'),tick=0;const counts={account:0,equipment:0,customer:0,services:0,categories:0},cache=new Map();const iso=()=>new Date(clock).toISOString();
 const vendor=async path=>{
  const u=new URL(path,'https://connect.mhelpdesk.com');if(u.pathname==='/api/v1.0/users/me'){counts.account++;return {portalId:224643};}
  if(u.pathname.endsWith('/equipment')){counts.equipment++;const offset=u.searchParams.has('rowIndex')?Number(u.searchParams.get('rowIndex'))-1:0;return {totalRows:1001,results:items.slice(offset,offset+200)};}
  if(u.pathname.endsWith('/equipmentTypes')){counts.categories++;return {totalRows:1,results:[{equipmentTypeId:1,portalId:224643,category:'Ranger'}]};}
  const match=u.pathname.match(/\/customers\/(\d+)(\/servicelocations)?$/);assert(match);const id=Number(match[1]);const address1=tick>=48?'Changed service street':'Original service street';
  if(match[2]){counts.services++;return {totalRows:1,results:[{customerId:id,serviceLocationId:id+100,portalId:224643,name:'Synthetic site '+id,isActive:true,address1,city:'Synthetic City',state:'TX',zip:'77002',countryId:'US'}]};}
  counts.customer++;return {customerId:id,portalId:224643,name:'Synthetic parent '+id,isServiceLocation:id>=61,isActive:true,address1,city:'Synthetic City',state:'TX',zip:'77002',countryId:'US'};
 };
 const policy=async(action,key,payload,observedAt)=>{const entry=cache.get(key);if(action==='read')return entry&&entry.expires>clock?{hit:true,payload:entry.payload,observedAt:entry.observedAt}:{hit:false};cache.set(key,{payload,observedAt,expires:clock+3*3600000});return {saved:true};};
 const partner=createMhelpPartnerHandler({getConfig:()=>({accessToken:'synthetic-only',portalId:'224643'}),readNativeUnits:async()=>[],fullEquipmentReview:true,fetch:async url=>Response.json(await vendor(String(url)))});
 const equipment=()=>partner('/api/mhelpdesk/partner/preview','POST',{});let last;
 for(tick=0;tick<96;tick++){
  clock=Date.parse('2026-10-20T00:00:00Z')+tick*15*60000;const resources=createInventoryCache({cache:policy,read:vendor,now:()=>clock});last=await readInventorySource({review:await equipment(),baseline,read:resources.read,observedAt:resources.observedAt,now:iso,verifyEquipment:equipment});
  assert.equal(last.summary.total,1001);assert.equal(last.summary.field,287);assert.equal(last.summary.shop,714);assert.equal(last.records[714].sourceAddress.street,tick>=48?'Changed service street':'Original service street');
 }
 assert.deepEqual(counts,{account:192,equipment:1344,customer:504,services:448,categories:8});assert.equal(Object.values(counts).reduce((a,b)=>a+b),2496);assert(counts.equipment+counts.customer+counts.services+counts.categories<3000);
 assert.equal(last.readAt,'2026-10-20T23:45:00.000Z');assert.equal(last.records[714].sourceDates.apiAddressObservedAt,'2026-10-20T21:00:00.000Z');assert.equal(last.records[714].apiAssignment.placementProof.version,1);
});
