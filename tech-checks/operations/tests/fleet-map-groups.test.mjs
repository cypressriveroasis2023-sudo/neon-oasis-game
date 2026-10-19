import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetMapGroups,fleetIndividualPinPositions} from '../src/fleetMapGroups.ts';
const p=(item,x,y)=>({item,x,y});
const center=g=>({x:g.reduce((sum,p)=>sum+p.x,0)/g.length,y:g.reduce((sum,p)=>sum+p.y,0)/g.length});
test('address and GPS collisions group without chaining separate sites together',()=>{
 const points=[p('address:A',0,0),p('native:B',45,0),p('address:C',90,0),p('address:D',300,200)];
 const original=structuredClone(points),groups=fleetMapGroups(points);
 assert.deepEqual(groups.map(g=>g.map(p=>p.item).sort()),[['address:A','native:B'],['address:C'],['address:D']]);
 assert.deepEqual(points,original);
});
test('all members survive dense sites and zooming separates nearby sites',()=>{
 const dense=Array.from({length:287},(_,i)=>p(String(i),i%7,i%9));
 assert.equal(fleetMapGroups(dense).length,1);
 assert.equal(new Set(fleetMapGroups(dense).flat().map(p=>p.item)).size,287);
 const nearby=[p('A',0,0),p('B',40,40)];
 assert.equal(fleetMapGroups(nearby).length,1);
 assert.equal(fleetMapGroups(nearby.map(p=>({...p,x:p.x*4,y:p.y*4}))).length,2);
});
test('rendered centroid touch boxes never overlap, including diagonal neighbors',()=>{
 const points=Array.from({length:120},(_,i)=>p(i,(i*79)%650,(i*107)%400));
 const groups=fleetMapGroups(points);
 for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=center(groups[i]),b=center(groups[j]);assert.ok(Math.abs(a.x-b.x)>=48||Math.abs(a.y-b.y)>=48);}
 assert.deepEqual(groups.flat().map(p=>p.item).sort((a,b)=>a-b),points.map(p=>p.item));
});
test('a long chain of nearby sites keeps multiple compact markers at the same zoom',()=>{
 const points=Array.from({length:40},(_,i)=>p('Product '+i,i*45,0));
 const groups=fleetMapGroups(points);
 assert.ok(groups.length>=15,'distinct sites must not collapse into one transitive group');
 assert.ok(groups.every(group=>group.length<=3));
 assert.deepEqual(groups.flat().map(p=>p.item).sort(),points.map(p=>p.item).sort());
 assert.deepEqual(fleetMapGroups(points),groups,'grouping is deterministic');
});

test('individual layout retains all identities and immutable source points at dense addresses',()=>{
 const points=Array.from({length:161},(_,i)=>p(String(i),180,180)),original=structuredClone(points),layout=fleetIndividualPinPositions(points,{width:366,height:400});
 assert.equal(layout.length,161);assert.deepEqual(points,original);assert.equal(new Set(layout.map(p=>p.item)).size,161);
 for(let i=0;i<layout.length;i++){assert.equal(layout[i].sourceX,180);assert.equal(layout[i].sourceY,180);for(let j=i+1;j<layout.length;j++)assert.ok(Math.abs(layout[i].x-layout[j].x)>=56||Math.abs(layout[i].y-layout[j].y)>=64);}
 assert.deepEqual(fleetIndividualPinPositions(points,{width:366,height:400}),layout);
});
test('offscreen sites retain their map position rather than being pulled into the viewport',()=>{
 const input=[p('offscreen',-100,200),p('visible',200,200)];assert.deepEqual(fleetIndividualPinPositions(input,{width:366,height:400})[0],{...input[0],sourceX:-100,sourceY:200});
});
