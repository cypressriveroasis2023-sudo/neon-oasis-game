/** Small per-history-entry UI state only. Never stores source records or authorization. */
export type FieldMapView={search:string;status:string;health:string;selectedId:string;nearbyId:string;radius:number;showHistorical:boolean;center?:[number,number];zoom?:number};
export function readFieldMapView(state:any):Partial<FieldMapView>{
  const value=state?.cosFieldMapView;
  if(!value||typeof value!=='object')return {};
  const text=(key:string)=>typeof value[key]==='string'?value[key]:'';
  const center=Array.isArray(value.center)&&value.center.length===2&&value.center.every(Number.isFinite)&&Math.abs(value.center[0])<=90&&Math.abs(value.center[1])<=180?value.center:undefined;
  return {search:text('search'),status:['field','all','installed','tracker','assigned','in_transit','returning','missing'].includes(value.status)?value.status:'field',health:['all','online','offline','unknown','support'].includes(value.health)?value.health:'all',selectedId:text('selectedId'),nearbyId:text('nearbyId'),radius:[5,10,25,50].includes(value.radius)?value.radius:10,showHistorical:value.showHistorical===true,center,zoom:typeof value.zoom==='number'&&value.zoom>=1&&value.zoom<=19?value.zoom:undefined};
}
export function saveFieldMapView(value:Partial<FieldMapView>){
  if(!/^#(?:field-map|field-view)(?:\?|$)/.test(location.hash))return;
  history.replaceState({...history.state,cosFieldMapView:{...readFieldMapView(history.state),...value}},'');
}
