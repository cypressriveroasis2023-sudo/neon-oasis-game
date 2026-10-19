import test from 'node:test';
import assert from 'node:assert/strict';
import {compactMapGroups,compactMapStatusCounts,compactGroupMarkup,compactGroupDescription,COMPACT_MAP_GROUP_THRESHOLD} from '../src/fleetCompactMap.ts';

const point=(item,x,y)=>({item,x,y});
test('small filtered map remains individual while a dense map groups without hiding identities',()=>{
 const small=Array.from({length:3},(_,i)=>point('offline-'+i,50,50));
 assert.equal(compactMapGroups(small).length,3);
 const dense=Array.from({length:161},(_,i)=>point('mhelp:'+String(i+1),160,180));
 const snapshot=structuredClone(dense),groups=compactMapGroups(dense);
 assert.equal(COMPACT_MAP_GROUP_THRESHOLD,18);
 assert.equal(groups.length,1);
 assert.equal(groups[0].length,161);
 assert.equal(new Set(groups.flat().map(x=>x.item)).size,161);
 assert.deepEqual(dense,snapshot,'only rendered positions group; source coordinates/identities are immutable');
});
test('geographically separated locations stay separate when zoomed in',()=>{
 const dense=Array.from({length:24},(_,i)=>point(i,i*90,60));
 assert.equal(compactMapGroups(dense).length,dense.length);
 const clustered=dense.map(p=>({...p,x:p.x/20}));
 assert.ok(compactMapGroups(clustered).length<dense.length);
 assert.equal(compactMapGroups(clustered).flat().length,dense.length);
});
test('offline group has an explicit red alert while the ring reflects all statuses',()=>{
 const members=[{health:'online'},{health:'offline'},{health:'unknown'},{health:'support'},{health:'unknown'}];
 const counts=compactMapStatusCounts(members);
 assert.deepEqual(counts,{online:1,offline:1,unknown:2,support:1});
 const svg=compactGroupMarkup(counts);
 assert.match(svg,/cos-compact-group-alert/);
 assert.match(svg,/cos-compact-group-total[^>]*>5<\/b>/);
 for(const color of ['#2bff35','#ff2734','#94a3b8','#15a8ff'])assert.ok(svg.includes(color));
 assert.match(compactGroupDescription(counts),/1 offline/);
 assert.match(compactGroupDescription(counts),/2 unverified/);
 assert.ok(!compactGroupMarkup({online:2,offline:0,unknown:0,support:0}).includes('cos-compact-group-alert'));
});
test('unknown is never reclassified as an outage by grouping',()=>{
 const counts=compactMapStatusCounts([{health:'unknown'},{health:'support'},{health:'online'}]);
 assert.deepEqual(counts,{online:1,offline:0,unknown:1,support:1});
 assert.doesNotMatch(compactGroupDescription(counts),/offline/);
});
