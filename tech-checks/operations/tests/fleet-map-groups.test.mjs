import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetMapGroups} from '../src/fleetMapGroups.ts';
const p=(item,x,y)=>({item,x,y});
test('connected overlapping touch targets become one group across address and GPS layers',()=>{
 const points=[p('address:A',0,0),p('native:B',45,0),p('address:C',90,0),p('address:D',300,200)];
 const original=structuredClone(points),groups=fleetMapGroups(points);
 assert.deepEqual(groups.map(g=>g.map(p=>p.item).sort()),[['address:A','address:C','native:B'],['address:D']]);
 assert.deepEqual(points,original);
});
test('all members survive dense sites and zooming separates nearby sites',()=>{
 const dense=Array.from({length:287},(_,i)=>p(String(i),i%7,i%9));
 assert.equal(fleetMapGroups(dense).length,1);
 assert.equal(new Set(fleetMapGroups(dense).flat().map(p=>p.item)).size,287);
 const nearby=[p('A',0,0),p('B',50,70)];
 assert.equal(fleetMapGroups(nearby).length,1);
 assert.equal(fleetMapGroups(nearby.map(p=>({...p,x:p.x*4,y:p.y*4}))).length,2);
});
test('separated group touch boxes never overlap, including diagonal neighbors',()=>{
 const points=Array.from({length:120},(_,i)=>p(i,(i*79)%650,(i*107)%400));
 const groups=fleetMapGroups(points);
 for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++)for(const a of groups[i])for(const b of groups[j])assert.ok(Math.abs(a.x-b.x)>=52||Math.abs(a.y-b.y)>=72);
 assert.deepEqual(groups.flat().map(p=>p.item).sort((a,b)=>a-b),points.map(p=>p.item));
});
