import {housingArtwork,lensArtwork} from './eyeArtwork';
/** The same approved artwork as AnimatedEye, registered once per document. */
function approvedEyeArtwork(){
 if(typeof document==='undefined'||document.getElementById('cos-fleet-eye-artwork'))return;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='cos-fleet-eye-artwork';svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.style.position='absolute';svg.style.pointerEvents='none';
 svg.innerHTML='<defs><clipPath id="cos-fleet-eye-aperture"><path d="M 279 585 C 386 463 501 404 625 404 C 750 404 869 470 975 584 C 869 697 744 758 627 758 C 503 758 381 690 279 585 Z"/></clipPath><image id="cos-fleet-eye-housing" href="'+housingArtwork+'" width="1254" height="1254"/><image id="cos-fleet-eye-lens" href="'+lensArtwork+'" x="422" y="375" width="410" height="410"/></defs>';document.body.append(svg);
}
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
export const fieldReticleColors = {online:'#2bff35',offline:'#ff2734',unknown:'#94a3b8',support:'#15a8ff'};
export function mapUnitIdentifier(unitNumber:string):string {
  // Only numeric characters reach the HTML template. Full imported labels stay text nodes.
  return /^(?:SOLAR\s*SPOTTER|SS\s*HYBRID|SPOTTER|RANGER|HELIOS|SNIPER(?:\s+[24](?=\s))?|CAM\s*V|RSU|RECON(?:\s*II)?)[\s#-]*(\d{1,6}(?:\.\d+)?)(?:HD4|HDC[24]S?|HD)?$/i.exec(unitNumber.trim())?.[1] || /^ST\s*[-#]?\s*(\d{1,6})$/i.exec(unitNumber.trim())?.[1] || /(?:^|\s|[-#])(\d{1,6}(?:\.\d+)?)$/.exec(unitNumber.trim())?.[1] || '';
}
function individualReticleArtwork(support:boolean) {
  // Inline vector paths use only controlled markup/currentColor: no shared filter IDs.
  if(!support){approvedEyeArtwork();return '<svg class="company-eye cos-reticle-artwork cos-reticle-approved-eye" data-cos-eye="approved" viewBox="0 0 1254 1254" width="44" height="44" aria-hidden="true" focusable="false"><use href="#cos-fleet-eye-housing"/><g clip-path="url(#cos-fleet-eye-aperture)"><g class="company-eye-gaze"><use href="#cos-fleet-eye-lens"/></g></g><circle cx="627" cy="627" r="589" fill="none" stroke="currentColor" stroke-width="48"/></svg>';}
  const center= '<g class="cos-reticle-solar-panel"><path d="M18 14H35L29 28H12Z" fill="currentColor" stroke="#bdefff" stroke-width="1.2" stroke-linejoin="round"/><path d="M23.5 14 17.5 28M29.5 14 23.5 28M15 21H32" fill="none" stroke="#bdefff" stroke-width=".9"/><path d="M23 28V35M16 35H31" stroke="currentColor" stroke-width="2.7"/><path d="M14 33.5H19V36.5H14ZM28 33.5H33V36.5H28Z" fill="currentColor"/></g>';
  return '<svg class="cos-reticle-artwork" viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true" focusable="false"><g class="cos-reticle-arcs" stroke="currentColor" stroke-width="2.3"><path d="M28 7A17.5 17.5 0 0 1 41 20M41 28A17.5 17.5 0 0 1 28 41M20 41A17.5 17.5 0 0 1 7 28M7 20A17.5 17.5 0 0 1 20 7"/><path d="M24 1V7M41 24H47M24 41V47M1 24H7" stroke-width="2.7"/></g>'+center+'</svg>';
}
export function mapReticleMarkup(unitNumber:string,state:ReticleState,location:'current'|'estimate'|'recorded'|'historical'='current') {
  const label=mapUnitIdentifier(unitNumber);
  return '<span class="cos-field-pin'+(state==='support'?' cos-field-pin-support':'')+(location==='recorded'?' cos-field-pin-estimate cos-field-pin-recorded':location==='estimate'?' cos-field-pin-estimate':location==='historical'?' cos-field-pin-historical':'')+'" data-health="'+state+'" style="--pin:'+fieldReticleColors[state]+'">'+individualReticleArtwork(state==='support')+'<b class="cos-pin-unit-number'+(label.length>3?' cos-reticle-long-id':'')+'" aria-hidden="true">'+(label||'—')+'</b>'+(location==='current'?'':'<em class="cos-pin-location-tag">'+(location==='recorded'?'SRC':location==='estimate'?'EST':'OLD')+'</em>')+'</span>';
}
export type ReticleCounts = Record<ReticleState,number>;
export function clusterReticleState(counts:ReticleCounts):ReticleState|'mixed' {
  const cameraStates=(['online','offline','unknown'] as const).filter(state=>counts[state]>0);
  return cameraStates.length>1?'mixed':cameraStates[0]||'support';
}
export function clusterReticleMarkup(counts:ReticleCounts,estimateCount=0,historicalCount=0,recordedCount=0) {
  const count=Object.values(counts).reduce((sum,value)=>sum+value,0),state=clusterReticleState(counts),color=fieldReticleColors[state==='mixed'?'unknown':state];
  return '<span class="cos-field-cluster" data-health="'+state+'" data-estimate-count="'+estimateCount+'" style="--pin:'+color+'"><i class="cos-reticle-ring"></i><b aria-hidden="true">'+count+'</b><em class="cos-cluster-caption">'+(state==='mixed'?'MIX':'GROUP')+'</em>'+(counts.support&&state!=='support'?'<i class="cos-cluster-support" title="'+counts.support+' support units; 0 cameras">'+mapSymbol(true)+'<small>'+counts.support+'</small></i>':'')+(estimateCount||historicalCount||recordedCount?'<em class="cos-cluster-location">'+[estimateCount?'EST':'',recordedCount?'SRC':'',historicalCount?'OLD':''].filter(Boolean).join(' / ')+'</em>':'')+'</span>';
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
