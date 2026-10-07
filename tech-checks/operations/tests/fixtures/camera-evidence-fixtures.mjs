/** Synthetic public DTOs. No backend imports, deployment IDs, or production records. */
export const now=Date.parse('2026-10-06T18:00:00Z'),fresh='2026-10-06T17:55:00Z';
export function resource(id,unit='Helios 1',options={}){
 const type=options.type||'IPC',resource=type==='NVR'?'recorder':['detector','Reconeyez detector'].includes(type)?'detector':['IPC','camera'].includes(type)?'camera':'unknown';
 return {id,name:'Synthetic resource '+id,unit,type,organization:'Synthetic site',activationState:'active',scope:'field',status:'review',evidence:{kind:resource==='unknown'?'unknown':'provider',source:resource==='detector'?'Reconeyez':'Star4Live',resource,active:true,status:'online',observedAt:fresh,lastOnlineAt:fresh},...options};
}
export const port=(options={})=>({kind:'service_port',source:'Direct service-port check',resource:'service',active:true,status:'online',observedAt:fresh,lastOnlineAt:null,reachable:true,confirmedOutage:false,consecutiveFailures:0,...options});
export function snapshot(rows){
 const field=rows.filter(row=>row.scope==='field');
 return {rows,totalDevices:rows.length,fieldDevices:field.length,healthRows:0,shopRoot:rows.filter(row=>row.scope==='shop').length,online:0,offline:0,review:field.length,refreshedAt:new Date(now).toISOString(),evidenceVersion:2,inventory:{allRecords:rows.length,activeFieldRecords:field.length,activeShopRecords:rows.filter(row=>row.scope==='shop').length,inactiveRecords:rows.filter(row=>row.scope==='inactive').length,unknownScopeRecords:rows.filter(row=>row.scope==='unknown').length}};
}
export const withStatus=(row,status,observedAt=fresh)=>({...row,evidence:{...row.evidence,status,observedAt}});
