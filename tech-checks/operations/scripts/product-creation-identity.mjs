// Preparation only. SQL remains the authoritative validator under inventory locks.
// A label outside these complete contracts is rejected, never shortened to a base.
export function creationIdentity(record) {
 if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.number!=='string'||!/^(?!000)[0-9]{3}$/.test(record.number))throw new Error('A complete three-digit equipment number is required.');
 const n=record.number,contracts={
  stand:{category:'Stand',capacity:null,label:`ST ${n}`,family:'STANDS',pattern:`^(ST|Stand) ${n}$`},
  solar_pole:{category:'Solar Pole 72',capacity:72,label:`Solar Pole 72 ${n}`,family:'SOLAR POLES & SKIDS',pattern:`^Solar Pole (${n} 72|72 ${n})( \\(Hybrid Solar Stand\\))?$`,flags:'i'},
  wall_e:{category:'Wall-E',capacity:null,label:`WA ${n}`,family:'WALL-E',pattern:`^(WA|Wall-E|Wall E) ${n}$`},
  camv:{category:'CAM-V',capacity:null,label:`CAMV ${n}`,family:'CAM V & RSU',pattern:`^CAM[- ]?V ${n}$`},
  sniper_2:{category:'Sniper 2',capacity:null,label:`Sniper 2 ${n}`,family:'SNIPERS',pattern:`^Sniper 2[- ]${n}$`}
 };
 const type=Object.hasOwn(contracts,record.kind)?contracts[record.kind]:null;
 if(!type||typeof record.sourceLabel!=='string'||record.sourceCategory!==type.category||record.capacity!==type.capacity||!new RegExp(type.pattern,type.flags).test(record.sourceLabel)||Object.hasOwn(record,'variant'))throw new Error('Unsupported or inconsistent complete equipment identity.');
 return {unitNumber:type.label,family:type.family,identityKey:`${type.category}|${n}`};
}
export function validateCreationBatch(records) {
 if(!Array.isArray(records)||records.length<1||records.length>100)throw new Error('A bounded records array is required.');
 const products=new Set(),identities=new Set();
 return records.map(record=>{
  if(typeof record?.productId!=='string'||!/^[1-9][0-9]{0,18}$/.test(record.productId)||BigInt(record.productId)>9223372036854775807n)throw new Error('An actual source ProductId is required.');
  const identity=creationIdentity(record);
  if(products.has(record.productId)||identities.has(identity.identityKey))throw new Error('Duplicate or ambiguous equipment identity.');
  products.add(record.productId);identities.add(identity.identityKey);return identity;
 });
}
