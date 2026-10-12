type Point={latitude:number;longitude:number};
export type TourRow={unit:{id:string;unitNumber:string};health:{state:string};point?:Point|null};
export type TvMapArea={kind:'overview'|'closeup';label:string;ids:string[];points:Point[];offline:number;online:number};
const radians=(value:number)=>value*Math.PI/180;
const distance=(a:Point,b:Point)=>{
  const lat=radians(b.latitude-a.latitude),lon=radians(b.longitude-a.longitude);
  const h=Math.sin(lat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(lon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
};
const valid=(point:Point|undefined|null):point is Point=>Boolean(point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180);
export const tvOutageRows=<T extends {health:{state:string}}>(rows:T[])=>rows.filter(row=>row.health.state==='offline');
export const tvCameraPageSize=(width:number,height:number)=>width<900?1:width<1500?4:height<900?3:6;

/** Stable local areas, with a 25 km diameter limit to keep each view close. */
export function tvMapTour(rows:TourRow[]):TvMapArea[] {
  const located=rows.filter(row=>valid(row.point)).sort((a,b)=>a.point!.latitude-b.point!.latitude||a.point!.longitude-b.point!.longitude||a.unit.id.localeCompare(b.unit.id));
  const groups:TourRow[][]=[];
  for(const row of located){
    const candidates=groups.map((group,index)=>({index,distance:Math.max(...group.map(member=>distance(member.point!,row.point!)))})).filter(group=>group.distance<=25).sort((a,b)=>a.distance-b.distance||a.index-b.index);
    if(candidates.length)groups[candidates[0].index].push(row);else groups.push([row]);
  }
  const area=(group:TourRow[],kind:TvMapArea['kind'],label:string):TvMapArea=>({kind,label,ids:group.map(row=>row.unit.id),points:group.map(row=>row.point!),offline:tvOutageRows(group).length,online:group.filter(row=>row.health.state==='online').length});
  const closeups=groups.map(group=>{
    const first=[...group].sort((a,b)=>Number(b.health.state==='offline')-Number(a.health.state==='offline')||a.unit.unitNumber.localeCompare(b.unit.unitNumber))[0];
    return area(group,'closeup','Area near '+first.unit.unitNumber);
  }).sort((a,b)=>b.offline-a.offline||a.points[0].latitude-b.points[0].latitude||a.points[0].longitude-b.points[0].longitude);
  return [area(located,'overview','All field units'),...closeups];
}
