import {fieldProductFixture,fieldProductConnectionFixture} from './mhelp-field-health-fixtures.mjs';
import {resource,snapshot} from './camera-evidence-fixtures.mjs';
export function largeFleetFixture(){
const f=fieldProductFixture(),n=925,field=286;
const units=Array.from({length:n},(_,i)=>({...f.units[0],id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,unitNumber:i>=203&&i<field?'ST '+(i+1):'Spotter '+(i+1),modelName:i>=203&&i<field?'STANDS':'Spotter',currentLocationType:i<field?'field':'shop',placement:i<field?'FIELD':'SHOP'}));
const rows=Array.from({length:739},(_,i)=>resource(i+1,units[i%203].unitNumber));
const health={...snapshot(rows),identityVersion:1,identityWarnings:[],unitIdentities:units.slice(0,203).map(u=>({unitId:u.id,unitNumber:u.unitNumber,kind:'native_provider',deviceIds:rows.filter(r=>r.unit===u.unitNumber).map(r=>String(r.id)),unitKeys:[u.unitNumber],proof:'a'.repeat(64)}))};
const records=units.map((u,i)=>({...f.upload.records[0],recordId:'mhelp_product:'+(5000+i),productId:String(5000+i),unitNumber:u.unitNumber,category:u.modelName,placement:u.placement,binding:{state:'linked',unitIds:[u.id],candidateUnitIds:[],placementHeld:false}}));
const upload={...f.upload,records,summary:{...f.upload.summary,totalRecords:n,fieldRecords:field,shopRecords:n-field,unflaggedFieldRecords:field,unflaggedShopRecords:n-field,doNotUseRecords:0}};
const items=units.map((u,i)=>({...f.roster.items[0],id:'cos_unit:'+u.id,unitId:u.id,unit:u,unitNumber:u.unitNumber,placement:u.currentLocationType,productIds:[records[i].productId],sourceRecordIds:[records[i].recordId],representedUnitIds:[u.id]}));
const map={...f.field,items:units.slice(0,field),inventoryItems:units,summary:{...f.field.summary,fieldUnits:field,missingGps:field},uploadInventory:upload,fleetRoster:{...f.roster,items,summary:{totalRecords:n,activeRecords:n,field,shop:n-field,review:0,excludedLifecycle:0,sourceOnlyRecords:0,linkedUnitRecords:n}}};
const connections=fieldProductConnectionFixture(upload,f.fresh,Object.fromEntries(records.slice(0,203).map(r=>[r.productId,'online'])));
return {health,map,connections,now:f.now};
}
