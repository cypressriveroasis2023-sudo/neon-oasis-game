/** Deterministic screen-space groups. Every source identity belongs to exactly one group. */
export type MapPoint<T> = {item:T;x:number;y:number};
export function clusterMapPoints<T>(points:MapPoint<T>[],radius=38,verticalPadding=0):MapPoint<T>[][] {
  const groups:MapPoint<T>[][]=[];
  for(const point of points){
    const group=groups.find(rows=>Math.hypot((rows[0].x-point.x)/radius,(rows[0].y-point.y)/(radius+verticalPadding))<1);
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
function individualReticleArtwork(support:boolean) {
  // Inline vector paths use only controlled markup/currentColor: no shared filter IDs.
  const center=support
    ? '<g class="cos-reticle-solar-panel"><path d="M18 14H35L29 28H12Z" fill="currentColor" stroke="#bdefff" stroke-width="1.2" stroke-linejoin="round"/><path d="M23.5 14 17.5 28M29.5 14 23.5 28M15 21H32" fill="none" stroke="#bdefff" stroke-width=".9"/><path d="M23 28V35M16 35H31" stroke="currentColor" stroke-width="2.7"/><path d="M14 33.5H19V36.5H14ZM28 33.5H33V36.5H28Z" fill="currentColor"/></g>'
    : '<g class="cos-reticle-lens"><circle cx="24" cy="24" r="11" fill="currentColor"/><circle cx="24" cy="24" r="7.2" fill="#020a12"/><circle cx="27.1" cy="20.8" r="2.2" fill="#fff"/></g>';
  return '<svg class="cos-reticle-artwork" viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true" focusable="false"><g class="cos-reticle-arcs" stroke="currentColor" stroke-width="2.3"><path d="M28 7A17.5 17.5 0 0 1 41 20M41 28A17.5 17.5 0 0 1 28 41M20 41A17.5 17.5 0 0 1 7 28M7 20A17.5 17.5 0 0 1 20 7"/><path d="M24 1V7M41 24H47M24 41V47M1 24H7" stroke-width="2.7"/></g>'+center+'</svg>';
}
export function mapReticleMarkup(unitNumber:string,state:ReticleState,location:'current'|'estimate'|'historical'='current') {
  const label=mapUnitIdentifier(unitNumber);
  return '<span class="cos-field-pin'+(state==='support'?' cos-field-pin-support':'')+(location==='estimate'?' cos-field-pin-estimate':location==='historical'?' cos-field-pin-historical':'')+'" data-health="'+state+'" style="--pin:'+fieldReticleColors[state]+'">'+individualReticleArtwork(state==='support')+'<b class="cos-pin-unit-number'+(label.length>3?' cos-reticle-long-id':'')+'" aria-hidden="true">'+(label||'—')+'</b>'+(location==='current'?'':'<em class="cos-pin-location-tag">'+(location==='estimate'?'EST':'OLD')+'</em>')+'</span>';
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
export function expandedGroupOffsets(count:number,scale=1):{x:number;y:number}[] {
  if(count<2)return [];
  const offsets:{x:number;y:number}[]=[];
  // Multiple rings and extra vertical clearance keep below-marker labels apart.
  for(let ring=0;offsets.length<count;ring++){
    const radius=68+ring*64,slots=Math.min(count-offsets.length,ring===0?8:Math.floor(2*Math.PI*radius/64));
    for(let index=0;index<slots;index++){
      const angle=-Math.PI/2+index*2*Math.PI/slots+(ring%2&&slots>1?Math.PI/slots:0);
      offsets.push({x:Math.round(Math.cos(angle)*radius*scale),y:Math.round((Math.sin(angle)*radius*1.3-12)*scale)});
    }
  }
  return offsets;
}
