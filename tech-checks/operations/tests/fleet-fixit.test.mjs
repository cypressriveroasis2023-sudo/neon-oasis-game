import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../src/FleetFixIt.tsx',import.meta.url),'utf8');
const screen=readFileSync(new URL('../src/FleetCameraStatus.tsx',import.meta.url),'utf8');

test('four choices, not a wall of fields', () => {
 const ids=[...src.matchAll(/\{id:'(\w+)'/g)].map(m=>m[1]);
 assert.deepEqual(ids,['address','ip','placement','name']);
});

test('every choice says what it does before it is tapped', () => {
 const says=[...src.matchAll(/says:'([^']+)'/g)].map(m=>m[1]);
 assert.equal(says.length,4);
 for(const line of says){
  assert.ok(line.length>30,'too terse: '+line);
  assert.ok(/\.$/.test(line.trim()),'should be a sentence: '+line);
 }
});

test('the choices are in the words of the job, not the database', () => {
 const labels=[...src.matchAll(/label:'([^']+)'/g)].map(m=>m[1]);
 assert.deepEqual(labels,['Change where it is','Correct the public IP','Move it to the shop','Rename the unit']);
 for(const label of labels)assert.ok(!/field|record|placement_|sha|null/i.test(label),label);
});

test('a technician who cannot edit sees no edit choices at all', () => {
 // The panel already says once who may change a unit. Dead or duplicated
 // controls read as a fault rather than a permission.
 assert.match(src,/if\(!canEdit\)return null;/);
});

test('a button is never drawn for an action nothing will carry out', () => {
 const ts=readFileSync(new URL('../src/UnitTroubleshoot.tsx',import.meta.url),'utf8');
 assert.match(ts,/canDo=\(id:string\)=>Boolean\(onAction\)&&\(supported\?supported\.includes\(id\):false\)/);
 assert.match(ts,/check\.action&&canDo\(check\.action\.id\)&&<button/);
});

test('the screen only claims the actions it can really perform', () => {
 const offered=[...readFileSync(new URL('../src/unitTroubleshoot.ts',import.meta.url),'utf8')
  .matchAll(/action:\{id:'(\w+)'/g)].map(m=>m[1]);
 const wired=/EDITABLE_ACTIONS=\[([^\]]+)\]/.exec(screen)[1].match(/'(\w+)'/g).map(s=>s.replace(/'/g,''));
 // Swapping a camera and linking a router are real jobs this screen cannot do.
 for(const id of ['swap','router'])assert.ok(!wired.includes(id),id+' must not be offered as a button');
 for(const id of wired)assert.ok(offered.includes(id)||id==='name',id);
});

test('edit actions are withheld when the person cannot edit', () => {
 assert.match(screen,/supported=\{canEdit\?EDITABLE_ACTIONS:\[\]\}/);
});

test('each choice points at a real field on the edit form', () => {
 const fields=[...src.matchAll(/field:'(\w+)'/g)].map(m=>m[1]);
 for(const field of fields){
  assert.ok(screen.includes("id={'"+field+"-'+unit.unit}")||field==='placement',
   'no input for '+field);
 }
});

test('the shop line keeps the rule that shop is never an outage', () => {
 assert.match(src,/never counted as an outage/);
});

test('every step instruction is one sentence a person can act on', () => {
 const says=[...screen.matchAll(/^ (address|ip|placement|name):'(.+)',$/gm)].map(m=>m[2]);
 assert.equal(says.length,4);
 for(const line of says)assert.ok(/^[A-Z]/.test(line)&&line.length>25,line);
});
