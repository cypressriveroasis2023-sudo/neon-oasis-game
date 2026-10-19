import type {MapPoint} from './fieldMapMarkers';
/** Group complete screen-space touch boxes, including connected collisions.
 * Original coordinates and identities remain unchanged. Zooming separates groups.
 */
export function fleetMapGroups<T>(points:MapPoint<T>[]):MapPoint<T>[][] {
 const pending=points.slice(),groups:MapPoint<T>[][]=[];
 while(pending.length){
  const group=[pending.shift()!];
  for(let i=0;i<group.length;i++)for(let j=pending.length-1;j>=0;j--){
   if(Math.abs(group[i].x-pending[j].x)<52&&Math.abs(group[i].y-pending[j].y)<72)group.push(pending.splice(j,1)[0]);
  }
  groups.push(group);
 }
 // Moving a group badge to its centroid must not create a new badge collision.
 const center=(g:MapPoint<T>[])=>({x:g.reduce((n,p)=>n+p.x,0)/g.length,y:g.reduce((n,p)=>n+p.y,0)/g.length});
 for(let merged=true;merged;){
  merged=false;
  outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const a=center(groups[i]),b=center(groups[j]);
   if(Math.abs(a.x-b.x)<52&&Math.abs(a.y-b.y)<72){groups[i].push(...groups.splice(j,1)[0]);merged=true;break outer;}
  }
 }
 const order=new Map(points.map((p,i)=>[p,i]));
 return groups.map(group=>group.sort((a,b)=>order.get(a)!-order.get(b)!));
}
