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
