import {originalItSavedReadingSource} from './it-saved-readings-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {matchingApprovedTools} from '../src/approvedToolSearch.ts';
import {approvedToolGroups,visibleApprovedTools} from '../src/approvedCosNavigation.ts';
const label=name=>({'Units On Hand':'Shop inventory','Victron VRM':'Victron Power',Today:'Overview',Jobs:'Job flow',Billing:'Billing & Invoices'}[name]||name);
const find=(q,tracker=true)=>matchingApprovedTools(q,tracker,label);
const names=groups=>groups.flatMap(group=>group.items);
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');

test('blank search preserves all existing eligible tools, groups, and order',()=>{
 for(const tracker of [true,false])assert.deepEqual(find('',tracker),approvedToolGroups.map(group=>({label:group.label,items:visibleApprovedTools(group.items,tracker)})).filter(group=>group.items.length));
});
test('whitespace behaves as browsing without removing tools',()=>assert.deepEqual(find(' \t\n '),find('')));
test('search uses visible labels and original canonical keys',()=>{
 assert.deepEqual(names(find('shop inventory')),['Units On Hand']);
 assert.deepEqual(names(find('units on hand')),['Units On Hand']);
 assert.deepEqual(names(find('victron power')),['Victron VRM']);
 assert.deepEqual(names(find('VRM')),['Victron VRM']);
});
test('matching is case-insensitive and requires every word',()=>{
 assert.deepEqual(names(find('  CaMeRa   HeAlTh  ')),['Camera Health']);
 assert.deepEqual(names(find('camera finance')),[]);
});
test('a group name can find its existing tools without inventing destinations',()=>{
 assert.deepEqual(names(find('customers sites')),['Customers','Sites']);
 // Finance and purchasing are no longer offered, so searching finds nothing.
 assert.deepEqual(names(find('purchasing')),[]);
 assert.deepEqual(names(find('jobs')),[]);
});
test('tracker eligibility is applied before any search',()=>{
 assert.deepEqual(names(find('tracker',false)),[]);
 assert.deepEqual(names(find('tracker',true)),['Unit Tracker']);
 assert.ok(!names(find('Fleet',false)).includes('Unit Tracker'));
});
test('unexpected text is a literal query, not a regex or record lookup',()=>{
 for(const query of ['[','.*','__proto__','<script>','166.1.2.3','not-a-tool'])assert.deepEqual(find(query),[]);
});
test('search leaves metadata unchanged and does not duplicate tools',()=>{
 const before=JSON.stringify(approvedToolGroups);
 for(const q of ['','fleet','camera','review','power']){
  const results=names(find(q));assert.equal(new Set(results).size,results.length);
  for(const value of results)assert.ok(approvedToolGroups.some(group=>group.items.includes(value)));
 }
 assert.equal(JSON.stringify(approvedToolGroups),before);
});
test('the More search has no operational reader, storage, timer, or HTML injection',()=>{
 for(const name of ['OperationsAreas.tsx','approvedToolSearch.ts'])assert.doesNotMatch(source(name),/\b(?:fetch|setInterval|setTimeout|localStorage|sessionStorage)\b|api\.(?:get|post)|dangerouslySetInnerHTML|history\./);
 assert.match(source('OperationsAreas.tsx'),/onClick=\{\(\)=>navigate\(name\)\}/);
 assert.match(source('OperationsAreas.tsx'),/maxLength=\{120\}/);
 assert.match(source('OperationsAreas.tsx'),/search.current\?\.focus\(\)/);
});
test('the separate mobile More button uses the approved selection style',()=>{
 assert.match(source('App.tsx'),/className=\{!fleetOnly&&!dailyOnly&&\(menu\|\|selectedArea==='Operations'\)\?'cos-approved-selected':''\}/);
});
test('reviewed App baseline preserves the Owner mobile More highlight class',()=>{
 // Baseline: reviewed main 12a2dff071ee545efb6e0d380a0f78abbb5c4088.
 const restored=originalItSavedReadingSource('App.tsx',source('App.tsx')).replace("className={!fleetOnly&&!dailyOnly&&(menu||selectedArea==='Operations')?'cos-approved-selected':''}","className={!fleetOnly&&!dailyOnly&&(menu||selectedArea==='Operations')?'active':''}");
 const bytes=Buffer.from(restored);
 assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),'05cc472f4472fe61449bd08e9388b57836a3a4e1');
});
