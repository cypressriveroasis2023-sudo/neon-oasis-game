/** Deterministic screen-space groups. Every source identity belongs to exactly one group. */
export type MapPoint<T> = {item:T;x:number;y:number};
export function clusterMapPoints<T>(points:MapPoint<T>[],radius=38):MapPoint<T>[][] {
  const groups:MapPoint<T>[][]=[];
  for(const point of points){
    const group=groups.find(rows=>Math.hypot(rows[0].x-point.x,rows[0].y-point.y)<radius);
    if(group)group.push(point);else groups.push([point]);
  }
  return groups;
}
export function mapSymbol(support:boolean){return support?'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 3h14l-2 10H3zM11 13v7M6 21h11M6 8h11M10 3l-2 10M15 3l-2 10" fill="none" stroke="currentColor" stroke-width="2"/></svg>':'●';}

/** Presentation only. Camera evidence and support classification remain upstream. */
export type ReticleState = 'online'|'offline'|'unknown'|'support';
export const fieldReticleColors = {online:'#2bff35',offline:'#ff2734',unknown:'#d8dfe9',support:'#15a8ff'};
export function mapUnitIdentifier(unitNumber:string):string {
  // Only numeric characters reach the HTML template. Full imported labels stay text nodes.
  return /(?:^|\s|[-#])(\d{1,6}(?:\.\d+)?)$/.exec(unitNumber.trim())?.[1] || '';
}
export function mapReticleMarkup(unitNumber:string,state:ReticleState,location:'current'|'estimate'|'historical'='current') {
  const label=mapUnitIdentifier(unitNumber),center=state==='support'?mapSymbol(true):state==='unknown'||!label?'<i class="cos-reticle-dot"></i>':label;
  return '<span class="cos-field-pin'+(state==='support'?' cos-field-pin-support':'')+(location==='estimate'?' cos-field-pin-estimate':location==='historical'?' cos-field-pin-historical':'')+'" data-health="'+state+'" style="--pin:'+fieldReticleColors[state]+'"><i class="cos-reticle-ring"></i><b aria-hidden="true"'+(label.length>3?' class="cos-reticle-long-id"':'')+'>'+center+'</b>'+(location==='current'?'':'<em class="cos-pin-location-tag">'+(location==='estimate'?'EST':'OLD')+'</em>')+'</span>';
}
export type ReticleCounts = Record<ReticleState,number>;
export function clusterReticleState(counts:ReticleCounts):ReticleState|'mixed' {
  const cameraStates=(['online','offline','unknown'] as const).filter(state=>counts[state]>0);
  return cameraStates.length>1?'mixed':cameraStates[0]||'support';
}
export function clusterReticleMarkup(counts:ReticleCounts,estimateCount=0,historicalCount=0) {
  const count=Object.values(counts).reduce((sum,value)=>sum+value,0),state=clusterReticleState(counts),color=fieldReticleColors[state==='mixed'?'unknown':state];
  return '<span class="cos-field-cluster" data-health="'+state+'" data-estimate-count="'+estimateCount+'" style="--pin:'+color+'"><i class="cos-reticle-ring"></i><b aria-hidden="true">'+count+'</b><em class="cos-cluster-caption">'+(state==='mixed'?'MIX':'GROUP')+'</em>'+(counts.support&&state!=='support'?'<i class="cos-cluster-support" title="'+counts.support+' support units; 0 cameras">'+mapSymbol(true)+'<small>'+counts.support+'</small></i>':'')+(estimateCount||historicalCount?'<em class="cos-cluster-location">'+(estimateCount&&historicalCount?'EST / OLD':estimateCount?'EST':'OLD')+'</em>':'')+'</span>';
}
/** A bounded display offset only; recorded locations and distance calculations never change. */
export function expandedGroupOffsets(count:number):{x:number;y:number}[] {
  if(count<2)return [];
  const offsets:{x:number;y:number}[]=[];
  // Multiple rings keep adjacent targets apart instead of dropping larger sites.
  for(let ring=0;offsets.length<count;ring++){
    const radius=68+ring*56,slots=Math.min(count-offsets.length,Math.floor(2*Math.PI*radius/52));
    for(let index=0;index<slots;index++){
      const angle=-Math.PI/2+index*2*Math.PI/slots+(ring%2&&slots>1?Math.PI/slots:0);
      offsets.push({x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)});
    }
  }
  return offsets;
}
