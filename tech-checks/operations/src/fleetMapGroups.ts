import type {MapPoint} from './fieldMapMarkers';
/** Merge the closest colliding rendered markers, not chains of hidden members.
 * Each badge is drawn at its members' centroid; 52px status rings require
 * 56px separation for nonoverlapping target areas; original coordinates and identities stay intact.
 */
export function fleetMapGroups<T>(points:MapPoint<T>[]):MapPoint<T>[][] {
 // Co-located service addresses can contain hundreds of records. Combine those
 // once before checking nearby badges instead of repeating identical distances.
 const colocated=new Map<string,{members:MapPoint<T>[];x:number;y:number}>();
 for(const point of points){
  const key=point.x+','+point.y,group=colocated.get(key);
  if(group)group.members.push(point);
  else colocated.set(key,{members:[point],x:point.x,y:point.y});
 }
 const groups=[...colocated.values()];
 while(true){
  let pair:[number,number]|undefined,nearest=Infinity;
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const dx=Math.abs(groups[i].x-groups[j].x),dy=Math.abs(groups[i].y-groups[j].y);
   if(dx<56&&dy<56&&dx*dx+dy*dy<nearest){pair=[i,j];nearest=dx*dx+dy*dy;}
  }
  if(!pair)break;
  const [i,j]=pair,a=groups[i],b=groups[j],count=a.members.length+b.members.length;
  a.x=(a.x*a.members.length+b.x*b.members.length)/count;
  a.y=(a.y*a.members.length+b.y*b.members.length)/count;
  a.members.push(...b.members);groups.splice(j,1);
 }
 const order=new Map(points.map((p,i)=>[p,i]));
 return groups.map(group=>group.members.sort((a,b)=>order.get(a)!-order.get(b)!));
}

/** One displayed position per identity; recorded points remain immutable. */
export function fleetIndividualPinPositions<T>(points:MapPoint<T>[],viewport:{width:number;height:number}) {
 const occupied:{x:number;y:number}[]=[],stepX=56,stepY=64;
 const rings=Math.ceil(Math.sqrt(points.length))+3,candidates:{x:number;y:number;distance:number}[]=[];
 for(let y=-rings;y<=rings;y++)for(let x=-rings;x<=rings;x++)candidates.push({x:x*stepX,y:y*stepY,distance:x*x*stepX*stepX+y*y*stepY*stepY});
 candidates.sort((a,b)=>a.distance-b.distance||a.y-b.y||a.x-b.x);
 const inside=(x:number,y:number)=>x>=24&&x<=viewport.width-24&&y>=36&&y<=viewport.height-42&&!(x<80&&y<145);
 return points.map(point=>{
  const visible=point.x>=0&&point.x<=viewport.width&&point.y>=0&&point.y<=viewport.height;
  const clear=(x:number,y:number)=>occupied.every(p=>Math.abs(p.x-x)>=stepX||Math.abs(p.y-y)>=stepY);
  let chosen=candidates.find(d=>clear(point.x+d.x,point.y+d.y)&&(!visible||inside(point.x+d.x,point.y+d.y)));
  chosen??=candidates.find(d=>clear(point.x+d.x,point.y+d.y))!;
  const position={item:point.item,x:point.x+chosen.x,y:point.y+chosen.y,sourceX:point.x,sourceY:point.y};occupied.push(position);return position;
 });
}
