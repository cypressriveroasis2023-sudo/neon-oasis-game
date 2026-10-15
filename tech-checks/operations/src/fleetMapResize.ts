import type {Map} from 'leaflet';

/** Keep the geographic view exact when surrounding controls resize the map. */
export function resizeFleetMap(instance:Map) {
  instance.whenReady(()=>{
    const element=instance.getContainer();
    // Hidden maps have no meaningful viewport; retain the last visible geometry.
    if(!element.clientWidth||!element.clientHeight)return;
    const previousSize=instance.getSize();
    if(previousSize.x===element.clientWidth&&previousSize.y===element.clientHeight)return;
    const center=instance.getCenter(),zoom=instance.getZoom();
    instance.invalidateSize({pan:false});
    // Leaflet's normal pan path truncates subpixel offsets. A view reset retains
    // the exact center across odd/even canvas sizes without animating a pan.
    const options={animate:false,reset:true};
    instance.setView(center,zoom,options);
  });
}

/** Let requested motion finish before reconciling a concurrently changed size. */
export function observeFleetMapResize(instance:Map) {
  let ready=false,moving=false,pending=false,reconciling=false,disposed=false;
  const reconcile=()=>{
    if(disposed)return;
    pending=true;
    if(!ready||moving||reconciling)return;
    pending=false;reconciling=true;
    try{resizeFleetMap(instance);}finally{reconciling=false;}
  };
  const moveStart=()=>{if(!reconciling)moving=true;};
  const moveEnd=()=>{if(reconciling)return;moving=false;if(pending)reconcile();};
  const mapReady=()=>{ready=true;if(pending)reconcile();};
  instance.on('movestart',moveStart).on('moveend',moveEnd).whenReady(mapReady);
  const observer=new ResizeObserver(reconcile);
  observer.observe(instance.getContainer());
  return ()=>{disposed=true;observer.disconnect();instance.off('movestart',moveStart).off('moveend',moveEnd).off('load',mapReady);};
}
