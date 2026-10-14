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
/** Presentation only. Camera evidence and support classification remain upstream. */
export type ReticleState = 'online'|'offline'|'unknown'|'support';
export const fieldReticleColors = {online:'#2bff35',offline:'#ff2734',unknown:'#94a3b8',support:'#15a8ff'};
export function mapUnitIdentifier(unitNumber:string):string {
  // Only numeric characters reach the HTML template. Full imported labels stay text nodes.
  return /^(?:SOLAR\s*SPOTTER|SS\s*HYBRID|SPOTTER|RANGER|HELIOS|SNIPER(?:\s+[24](?=\s))?|CAM\s*V|RSU|RECON(?:\s*II)?)[\s#-]*(\d{1,6}(?:\.\d+)?)(?:HD4|HDC[24]S?|HD)?$/i.exec(unitNumber.trim())?.[1] || /^ST\s*[-#]?\s*(\d{1,6})$/i.exec(unitNumber.trim())?.[1] || /(?:^|\s|[-#])(\d{1,6}(?:\.\d+)?)$/.exec(unitNumber.trim())?.[1] || '';
}
function individualMarkerArtwork() {
  // A plain, solid status circle. Health classification stays entirely upstream.
  return '<svg class="cos-reticle-artwork cos-map-status-dot" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false"><circle cx="22" cy="22" r="19" fill="currentColor" stroke="#071421" stroke-width="2"/></svg>';
}
export function mapReticleMarkup(unitNumber:string,state:ReticleState,location:'current'|'estimate'|'recorded'|'historical'='current') {
  const label=mapUnitIdentifier(unitNumber);
  return '<span class="cos-field-pin'+(state==='support'?' cos-field-pin-support':'')+(location==='recorded'?' cos-field-pin-estimate cos-field-pin-recorded':location==='estimate'?' cos-field-pin-estimate':location==='historical'?' cos-field-pin-historical':'')+'" data-health="'+state+'" style="--pin:'+fieldReticleColors[state]+'">'+individualMarkerArtwork()+'<b class="cos-pin-unit-number'+(label.length>3?' cos-reticle-long-id':'')+'" aria-hidden="true">'+(label||'—')+'</b>'+(location==='current'?'':'<em class="cos-pin-location-tag">'+(location==='recorded'?'SRC':location==='estimate'?'EST':'OLD')+'</em>')+'</span>';
}
export type ReticleCounts = Record<ReticleState,number>;
export function clusterReticleState(counts:ReticleCounts):ReticleState|'mixed' {
  const cameraStates=(['online','offline','unknown'] as const).filter(state=>counts[state]>0);
  return cameraStates.length>1?'mixed':cameraStates[0]||'support';
}
export function clusterReticleMarkup(counts:ReticleCounts,estimateCount=0,historicalCount=0,recordedCount=0,unlinkedCount=0) {
  const nativeCount=Object.values(counts).reduce((sum,value)=>sum+value,0),count=nativeCount+unlinkedCount,state=unlinkedCount?(nativeCount?'mixed':'unlinked'):clusterReticleState(counts),color=state==='unlinked'?'#d6a84b':fieldReticleColors[state==='mixed'?'unknown':state];
  return '<span class="cos-field-cluster" data-health="'+state+'" data-estimate-count="'+estimateCount+'" data-unlinked-count="'+unlinkedCount+'" style="--pin:'+color+'"><i class="cos-reticle-ring" aria-hidden="true"></i><b aria-hidden="true">'+count+'</b><em class="cos-cluster-caption">'+(state==='unlinked'?'UNLINKED':state==='mixed'?'MIX':'GROUP')+'</em>'+(counts.support&&state!=='support'?'<i class="cos-cluster-support" title="'+counts.support+' support units; 0 cameras"><span class="cos-cluster-support-dot" aria-hidden="true"></span><small>'+counts.support+'</small></i>':'')+(estimateCount||historicalCount||recordedCount?'<em class="cos-cluster-location">'+[estimateCount?'EST':'',recordedCount?'SRC':'',historicalCount?'OLD':''].filter(Boolean).join(' / ')+'</em>':'')+'</span>';
}
/** A bounded display offset only; recorded locations and distance calculations never change. */
export function expandedGroupOffsets(count:number,scale=1,viewport?:{width:number;height:number;anchorX:number;anchorY:number;bottomInset:number;occupied?:{x:number;y:number}[];blocked?:{left:number;right:number;top:number;bottom:number}[]}):{x:number;y:number}[] {
  if(count<2)return [];
  // Prefer clear visible positions, reserving other nearby sites and their units.
  // All offsets are presentation-only; larger sites remain pannable without hiding identities.
  if(viewport){
    const columns=Math.max(2,Math.min(8,Math.floor((viewport.width-36)/(56*scale))));
    const rows=Math.ceil(count/columns)+4,candidates:{x:number;y:number;visible:boolean;preferred:boolean}[]=[];
    const anchorVisible=viewport.anchorX>=0&&viewport.anchorX<=viewport.width&&viewport.anchorY>=0&&viewport.anchorY<=viewport.height;
    const add=(x:number,y:number,preferred=false)=>{
      const px=viewport.anchorX+x,py=viewport.anchorY+y;
      const visible=!anchorVisible||(px-22*scale>=0&&px+22*scale<=viewport.width&&py-30*scale>=0&&py+37*scale<=viewport.height-viewport.bottomInset);
      candidates.push({x,y,visible,preferred});
    };
    if(count<=9)expandedGroupOffsets(count,scale).forEach(({x,y})=>add(x,y,true));
    const gridShift=anchorVisible?viewport.width/2-viewport.anchorX:0;
    for(let row=-rows;row<=rows;row++)for(let column=0;column<columns;column++)add(Math.round(gridShift+(column-(columns-1)/2)*56*scale),Math.round((row*70-12)*scale));
    candidates.sort((a,b)=>Number(b.visible)-Number(a.visible)||Number(b.preferred)-Number(a.preferred)||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y)||a.y-b.y||a.x-b.x);
    const blocked=(x:number,y:number)=>viewport.blocked?.some(box=>viewport.anchorX+x+22*scale>box.left&&viewport.anchorX+x-22*scale<box.right&&viewport.anchorY+y+37*scale>box.top&&viewport.anchorY+y-30*scale<box.bottom);
    const selected:{x:number;y:number}[]=[],occupied=[{x:0,y:0},...(viewport.occupied||[])];
    for(const {x,y} of candidates){
      if(blocked(x,y)||[...occupied,...selected].some(other=>Math.abs(x-other.x)<48*scale&&Math.abs(y-other.y)<68*scale))continue;
      selected.push({x,y});if(selected.length===count)return selected;
    }
    // Dense adjacent sites may exhaust the visible grid. Continue clear rows for map panning.
    for(let row=rows+1;selected.length<count;row++)for(let column=0;column<columns&&selected.length<count;column++){
      const x=Math.round(gridShift+(column-(columns-1)/2)*56*scale),y=Math.round((row*70-12)*scale);
      if(blocked(x,y)||[...occupied,...selected].some(other=>Math.abs(x-other.x)<48*scale&&Math.abs(y-other.y)<68*scale))continue;
      selected.push({x,y});
    }
    return selected;
  }
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
