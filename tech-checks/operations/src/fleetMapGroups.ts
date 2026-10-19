import type {MapPoint} from './fieldMapMarkers';
/** Merge the closest colliding rendered markers, not chains of hidden members.
 * Each badge is drawn at its members' centroid with a 44px touch box. A 48px
 * separation leaves a small gap; original coordinates and identities stay intact.
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
   if(dx<48&&dy<48&&dx*dx+dy*dy<nearest){pair=[i,j];nearest=dx*dx+dy*dy;}
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
