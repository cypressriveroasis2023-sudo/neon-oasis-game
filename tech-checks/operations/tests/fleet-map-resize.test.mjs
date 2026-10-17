import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resizeFleetMap,observeFleetMapResize} from '../src/fleetMapResize.ts';

// Load the production Leaflet implementation with only its import-time browser
// feature checks stubbed. No renderer or browser is launched. These fixtures
// exercise Leaflet's actual center, projection, resize, pan, zoom and fit methods.
const frames=new Map();let nextFrame=1;
function advanceFrames(){const batch=[...frames.values()];frames.clear();for(const frame of batch)frame();}
const observers=[];
globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
globalThis.window={requestAnimationFrame(callback){const id=nextFrame++;frames.set(id,callback);return id;},cancelAnimationFrame(id){frames.delete(id);},screen:{deviceXDPI:1,logicalXDPI:1},devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
globalThis.document={documentElement:{style:{}},createElement(tag){return {style:{},getContext:tag==='canvas'?()=>null:undefined}},addEventListener(){},removeEventListener(){}};
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'node',platform:'Linux'},configurable:true});
const L=createRequire(import.meta.url)('leaflet');
const center=map=>[map.getCenter().lat,map.getCenter().lng];
function fixture(width,height,{loaded=true}={}){
 const map=Object.create(L.Map.prototype);
 map.options={...L.Map.prototype.options};
 map._container={clientWidth:width,clientHeight:height,getElementsByClassName(){return [{}];}};
 map._loaded=loaded;map._zoom=15;map._size=L.point(width,height);map._sizeChanged=false;
 map._mapPane={style:{},className:''};L.DomUtil.setPosition(map._mapPane,L.point(0,0));
 map._pixelOrigin=map.project([29.76,-95.37]).subtract(map._size.divideBy(2)).round();
 map._lastCenter=null;
 return map;
}

for(const [width,closedHeight,expandedHeight,longitude] of [[507,425,402,-95.37001848220827],[888,449,426,-95.36999702453613]]){
 test(`Leaflet default resize reproduces the exact hosted ${width}px map drift`,()=>{
  const map=fixture(width,closedHeight);
  map._container.clientHeight=expandedHeight;map.invalidateSize();
  assert.deepEqual(center(map),[29.759981341402657,longitude]);
  map._container.clientHeight=closedHeight;map.invalidateSize();
  assert.deepEqual(center(map),[29.759999969071224,longitude]);
 });
 test(`resize preserves exact view through repeated odd/even ${width}px map sizes`,()=>{
  const map=fixture(width,closedHeight),before=center(map);
  for(let cycle=0;cycle<5;cycle++){
   for(const [w,h] of [[width,expandedHeight],[width,closedHeight],[width-1,expandedHeight],[width-1,closedHeight],[width,closedHeight]]){
    map._container.clientWidth=w;map._container.clientHeight=h;resizeFleetMap(map);
    assert.deepEqual(center(map),before);assert.equal(map.getZoom(),15);
    assert.deepEqual(map.getSize(),L.point(w,h));
   }
  }
 });
}

test('unchanged and hidden dimensions do not reset or move the current view',()=>{
 const map=fixture(507,425);map.setView([29.7612345,-95.3712345],16,{animate:false,reset:true});
 const before=center(map);let moves=0;map.on('moveend',()=>moves++);
 resizeFleetMap(map);assert.equal(moves,0);assert.deepEqual(center(map),before);
 for(const [width,height] of [[0,425],[507,0],[0,0]]){
  map._container.clientWidth=width;map._container.clientHeight=height;resizeFleetMap(map);
  assert.equal(moves,0);assert.deepEqual(center(map),before);assert.deepEqual(map.getSize(),L.point(507,425));
 }
 map._container.clientWidth=508;map._container.clientHeight=426;resizeFleetMap(map);
 assert.deepEqual(center(map),before);assert.equal(map.getZoom(),16);assert.deepEqual(map.getSize(),L.point(508,426));
});

test('an unloaded map defers center reads until its initial view is ready',()=>{
 const map=fixture(507,425,{loaded:false});let centerReads=0;
 map.getCenter=function(){centerReads++;return L.Map.prototype.getCenter.call(this);};
 map._container.clientHeight=402;resizeFleetMap(map);assert.equal(centerReads,0);
 map._loaded=true;const before=center(map);map.fire('load');
 assert.deepEqual(center(map),before);assert.deepEqual(map.getSize(),L.point(507,402));assert.equal(map.getZoom(),15);
});

test('resizing retains the latest intentional pan, zoom and fit rather than an old view',()=>{
 const map=fixture(507,425),initial=center(map);
 map.panBy(L.point(45,-25),{animate:false});const panned=center(map);assert.notDeepEqual(panned,initial);
 map._container.clientHeight=402;resizeFleetMap(map);assert.deepEqual(center(map),panned);
 map.setView([35.1234567,-97.7654321],17,{animate:false,reset:true});const zoomed=center(map);
 map._container.clientWidth=508;map._container.clientHeight=425;resizeFleetMap(map);
 assert.deepEqual(center(map),zoomed);assert.equal(map.getZoom(),17);
 map.fitBounds(L.latLngBounds([[29.76,-95.37],[29.76,-95.37]]),{padding:[40,50],maxZoom:15,animate:false});
 const fitted=center(map);assert.notDeepEqual(fitted,zoomed);assert.equal(map.getZoom(),15);
 map._container.clientWidth=507;map._container.clientHeight=402;resizeFleetMap(map);
 assert.deepEqual(center(map),fitted);assert.equal(map.getZoom(),15);
});


for(const action of ['fit','focus']){
 test(`an active animated ${action} reaches the exact uninterrupted destination before resize`,()=>{
  const map=fixture(507,402),control=fixture(507,402);
  for(const value of [map,control])value.panBy(L.point(45,-25),{animate:false});
  const panned=center(map),stop=observeFleetMapResize(map),observer=observers.at(-1);
  const start=value=>action==='fit'?value.fitBounds(L.latLngBounds([[29.76,-95.37],[29.76,-95.37]]),{padding:[40,50],maxZoom:15}):value.setView([29.761,-95.371],15);
  start(control);start(map);assert.equal(map._panAnim._inProgress,true);
  map._container.clientHeight=425;observer.callback();
  assert.equal(map._panAnim._inProgress,true);assert.deepEqual(map.getSize(),L.point(507,402));
  control._panAnim._startTime-=1000;map._panAnim._startTime-=1000;advanceFrames();
  assert.equal(map._panAnim._inProgress,false);assert.notDeepEqual(center(control),panned);
  assert.deepEqual(center(map),center(control));assert.equal(map.getZoom(),control.getZoom());
  assert.deepEqual(map.getSize(),L.point(507,425));stop();
 });
}

test('resize waits for an ongoing user drag and preserves its final position',()=>{
 const map=fixture(507,425),control=fixture(507,425),stop=observeFleetMapResize(map),observer=observers.at(-1);
 map.fire('movestart').fire('dragstart');control.fire('movestart').fire('dragstart');
 map._rawPanBy(L.point(20,-10));control._rawPanBy(L.point(20,-10));
 map._container.clientHeight=402;observer.callback();assert.deepEqual(map.getSize(),L.point(507,425));
 map._rawPanBy(L.point(25,-15));control._rawPanBy(L.point(25,-15));
 const expected=center(control);map.fire('dragend').fire('moveend');
 assert.deepEqual(center(map),expected);assert.deepEqual(map.getSize(),L.point(507,402));stop();
});

test('layout reset events are distinguishable from a later user move',()=>{
 const map=fixture(507,425);let resizing=false;
 const events=[],stop=observeFleetMapResize(map,active=>{resizing=active;});
 map.on('moveend',()=>events.push({resizing,center:center(map)}));
 const before=center(map);map._container.clientHeight=402;observers.at(-1).callback();
 assert.ok(events.length>0);assert.ok(events.every(event=>event.resizing));
 assert.deepEqual(center(map),before);assert.equal(resizing,false);
 events.length=0;map.panBy(L.point(45,-25),{animate:false});
 assert.ok(events.some(event=>!event.resizing));assert.notDeepEqual(center(map),before);stop();
});

test('resize waits for an active zoom and keeps the exact target center and level',()=>{
 const map=fixture(507,425),control=fixture(507,425),stop=observeFleetMapResize(map),observer=observers.at(-1);
 for(const value of [map,control]){value._zoomAnimated=true;value.setView([29.761,-95.371],16,{animate:true});}
 advanceFrames();assert.equal(map._animatingZoom,true);
 map._container.clientWidth=508;map._container.clientHeight=402;observer.callback();
 assert.equal(map._animatingZoom,true);assert.deepEqual(map.getSize(),L.point(507,425));
 control._onZoomTransitionEnd();map._onZoomTransitionEnd();advanceFrames();
 assert.deepEqual(center(map),[29.761,-95.371]);assert.deepEqual(center(map),center(control));assert.equal(map.getZoom(),16);
 assert.deepEqual(map.getSize(),L.point(508,402));stop();
});

test('disconnecting cancels pending resize reconciliation without stopping motion',()=>{
 const map=fixture(507,425),stop=observeFleetMapResize(map),observer=observers.at(-1);
 map.panBy(L.point(45,-25));map._container.clientHeight=402;observer.callback();stop();
 assert.equal(observer.disconnected,true);assert.equal(map._panAnim._inProgress,true);
 map._panAnim._startTime-=1000;advanceFrames();observer.callback();
 assert.deepEqual(map.getSize(),L.point(507,425));
});


test('an observer waits for initial load and can be disposed before it',()=>{
 const map=fixture(507,425,{loaded:false}),stop=observeFleetMapResize(map),observer=observers.at(-1);
 map._container.clientHeight=402;observer.callback();assert.deepEqual(map.getSize(),L.point(507,425));
 map._loaded=true;const before=center(map);map.fire('load');
 assert.deepEqual(center(map),before);assert.deepEqual(map.getSize(),L.point(507,402));stop();
 const removed=fixture(507,425,{loaded:false}),disconnect=observeFleetMapResize(removed),removedObserver=observers.at(-1);
 removed._container.clientHeight=402;removedObserver.callback();disconnect();removed._loaded=true;removed.fire('load');
 assert.deepEqual(removed.getSize(),L.point(507,425));
});
