/** Synthetic continuity counts mirror the operational distinction, not live data. */
export function assignmentContinuityItems(base){
 const changed=['2226860','2300344','2229407','2229931','2233383'];
 return Array.from({length:352},(_,index)=>{
  const historical=index>=344,changeIndex=index<3?index:index>=344&&index<346?index-341:-1;
  const productId=changeIndex<0?String(7000000+index):changed[changeIndex];
  const previousAssignment={productId,customerId:historical?'99':'100',placement:'FIELD',serviceLocationId:historical?'old-site':null,observedAt:'2026-10-13T10:00:00Z'};
  const currentAssignment={productId,customerId:'100',placement:'FIELD',serviceLocationId:null,observedAt:'2026-10-20T17:36:07.336985+00:00'};
  return {...base,productId,unitNumber:'Synthetic unit '+index,before:{...base.before,customerId:'100'},after:changeIndex<0?{...base.before,customerId:'100'}:base.after,
   identity:{...base.identity,trackerId:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),trackerLabel:'Synthetic unit '+index},sourceAssignmentChanged:changeIndex>=0,
   continuity:{kind:historical?'assignment_difference':'timestamp_only',previousAssignment,currentAssignment}};
 });
}
