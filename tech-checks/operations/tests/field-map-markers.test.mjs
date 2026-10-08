import {test} from 'node:test';import assert from 'node:assert/strict';
import {clusterMapPoints,mapUnitIdentifier,mapReticleMarkup,clusterReticleMarkup,clusterReticleState,expandedGroupOffsets,fieldReticleColors} from '../src/fieldMapMarkers.ts';
import {isSupportEquipment,fieldCameraHealth,unitHealthLabel} from '../src/fieldCameraHealth.ts';
test('screen groups retain all identities including identical coordinates',()=>{const rows=[{item:'a',x:0,y:0},{item:'b',x:0,y:0},{item:'c',x:30,y:0},{item:'d',x:80,y:0}];const groups=clusterMapPoints(rows);assert.deepEqual(groups.map(x=>x.map(p=>p.item)),[['a','b','c'],['d']]);});
test('support units have zero camera health even without provider data',()=>{for(const unitNumber of ['Solar Stand 72 044','Solar Stand 044','Solar Pole 003','Skid 012']){const unit={id:unitNumber,unitNumber};assert.equal(isSupportEquipment(unit),true);assert.equal(fieldCameraHealth(unit,[unit],null).state,'support');assert.equal(unitHealthLabel(fieldCameraHealth(unit,[unit],null)),'SUPPORT EQUIPMENT · 0 CAMERAS');}for(const unitNumber of ['Solar Spotter 044','Sniper 312','Helios 003'])assert.equal(isSupportEquipment({id:unitNumber,unitNumber}),false);});

// Tooltip labels must remain text, just like cluster and address popup content.
import fs from 'node:fs';
test('imported map labels are assigned as text instead of Leaflet HTML strings',()=>{const source=fs.readFileSync(new URL('../src/FieldMap.tsx',import.meta.url),'utf8');assert.match(source,/label.textContent=unit.unitNumber/);assert.match(source,/marker.bindTooltip\(label,/);assert.doesNotMatch(source,/bindTooltip\(unit.unitNumber/);});

test('approved reticles use safe unit identifiers, unknown circles and separate blue support',()=>{
  assert.equal(mapUnitIdentifier('SNIPER 2 005'),'005');assert.equal(mapUnitIdentifier('Recon II 022'),'022');assert.equal(mapUnitIdentifier('Helios 1.1'),'1.1');
  assert.equal(mapUnitIdentifier('<img src=x onerror=alert(1)>'),'');
  const online=mapReticleMarkup('Helios <img src=x> 014','online');assert.match(online,/>014<\/b>/);assert.doesNotMatch(online,/<img|onerror/);assert.match(online,/--pin:#2bff35/);
  assert.match(mapReticleMarkup('Helios 014','unknown'),/cos-reticle-circle/);assert.match(mapReticleMarkup('Helios 014','unknown'),/>014<\/b>/);
  assert.match(mapReticleMarkup('Solar Stand 044','support'),/data-health="support"/);assert.match(mapReticleMarkup('Solar Stand 044','support'),/--pin:#15a8ff/);
  assert.match(mapReticleMarkup('Helios 014','online','estimate'),/>EST<\/em>/);assert.match(mapReticleMarkup('Helios 014','online','historical'),/>OLD<\/em>/);
  assert.deepEqual(fieldReticleColors,{online:'#2bff35',offline:'#ff2734',unknown:'#d8dfe9',support:'#15a8ff'});
});
test('mixed camera observations and support counts never become a false all-online group',()=>{
  assert.equal(clusterReticleState({online:2,offline:0,unknown:0,support:1}),'online');
  assert.equal(clusterReticleState({online:0,offline:0,unknown:0,support:3}),'support');
  assert.equal(clusterReticleState({online:1,offline:1,unknown:0,support:1}),'mixed');
  assert.equal(clusterReticleState({online:1,offline:0,unknown:1,support:0}),'mixed');
  const html=clusterReticleMarkup({online:1,offline:1,unknown:0,support:1},1);
  assert.match(html,/data-health="mixed"/);assert.match(html,/>MIX<\/em>/);assert.match(html,/cos-cluster-support/);assert.match(html,/1 support units; 0 cameras/);assert.match(html,/>3<\/b>/);assert.match(html,/>EST<\/em>/);
});
test('expanded nearby markers use bounded display offsets without changing source points',()=>{
  for(const count of [2,3,8,9,27]){const offsets=expandedGroupOffsets(count);assert.equal(offsets.length,count);assert.equal(new Set(offsets.map(p=>`${p.x},${p.y}`)).size,count);assert.ok(offsets.every(p=>Math.hypot(p.x,p.y)<=268));}
  assert.deepEqual(expandedGroupOffsets(1),[]);
});

test('individual camera circles contain numbers while blue stands retain panel artwork',()=>{
  for(const state of ['online','offline','unknown']){const html=mapReticleMarkup('Helios 014',state);assert.match(html,/cos-reticle-circle/);assert.match(html,/class="cos-pin-unit-number"/);assert.match(html,/>014<\/b>/);assert.doesNotMatch(html,/cos-reticle-lens|cos-reticle-arcs|cos-reticle-dot|<defs|filter id=/);}
  const stand=mapReticleMarkup('Solar Stand 044','support');assert.match(stand,/cos-reticle-solar-panel/);assert.match(stand,/>044<\/b>/);assert.doesNotMatch(stand,/cos-reticle-circle/);
  const cluster=clusterReticleMarkup({online:1,offline:1,unknown:0,support:1});assert.match(cluster,/>3<\/b>/);assert.match(cluster,/>MIX<\/em>/);assert.doesNotMatch(cluster,/cos-pin-unit-number|cos-reticle-circle/);
});
test('vertical grouping clearance protects the new number labels without widening horizontal groups',()=>{
  const rows=[{item:'a',x:0,y:0},{item:'b',x:0,y:54},{item:'c',x:50,y:0}];
  assert.deepEqual(clusterMapPoints(rows,44,16).map(g=>g.map(p=>p.item)),[['a','b'],['c']]);
});

test('bounded number labels do not intersect another marker in larger peer layouts',()=>{
  for(let count=2;count<=100;count++){
    const points=expandedGroupOffsets(count);
    for(const [index,point] of points.entries())for(const [otherIndex,other] of points.entries()){
      if(index===otherIndex)continue;
      const intersects=point.x-22<other.x+22&&point.x+22>other.x-22&&point.y+21<other.y+22&&point.y+37>other.y-22;
      assert.equal(intersects,false,`${count} peers: label ${index} intersects marker ${otherIndex}`);
    }
  }
});

test('local-site layouts expose every identity while clearing other site anchors and unit labels',()=>{
  for(const scale of [1,1.18])for(const count of [2,9,12,27,100]){
    const viewport={width:308,height:430,anchorX:154,anchorY:215,bottomInset:100,occupied:[{x:80,y:0},{x:-80,y:0}]};
    const points=expandedGroupOffsets(count,scale,viewport);assert.equal(points.length,count);
    const obstacles=[{x:0,y:0},...viewport.occupied];
    for(const [index,point] of points.entries())for(const other of [...obstacles,...points.slice(0,index)])assert.ok(Math.abs(point.x-other.x)>=48*scale||Math.abs(point.y-other.y)>=68*scale);
  }
  const mobile=expandedGroupOffsets(12,1,{width:308,height:430,anchorX:154,anchorY:215,bottomInset:100});
  assert.ok(mobile.every(p=>p.x+154-22>=0&&p.x+154+22<=308&&p.y+215-30>=0&&p.y+215+37<=330));
});
