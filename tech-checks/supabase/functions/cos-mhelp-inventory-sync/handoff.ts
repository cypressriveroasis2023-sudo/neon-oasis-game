type Row=Record<string,any>;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0;

/** Refresh placement proof before asking the guarded Sheet publisher to run. */
export function createTrackerHandoff(options:{
 refreshPlacement:(req:Request,receipt:Row)=>Promise<Row>;
 publish:(req:Request,receipt:Row)=>Promise<Row>;
}){
 return async(req:Request,receipt:Row):Promise<Row>=>{
  let placement:Row;
  try{placement=await options.refreshPlacement(req,receipt);}catch{return {state:'not_started',placement:{state:'failed'}};}
  const placementState=typeof placement?.state==='string'?placement.state:'failed';
  const placementReceipt={state:placementState,confirmed:count(placement?.confirmed),held:count(placement?.held)};
  if(!object(placement)||placement.state!=='current'||placement.committed!==true||placement.sourceSha256!==receipt.sourceSha256)
   return {state:'not_started',placement:placementReceipt};
  try{
   const tracker=await options.publish(req,receipt);
   return {...tracker,placement:placementReceipt};
  }catch{return {state:'failed',placement:placementReceipt};}
 };
}
