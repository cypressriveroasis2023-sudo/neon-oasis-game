// The browser navigation helper opens retired workspaces by link because no menu
// offers them. Its list must be exactly the app's list, or a spec could reach a
// workspace by link that a user can still reach through the menu (or the reverse).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RETIRED_WORKSPACES} from '../src/approvedCosNavigation.ts';

test('the browser helper retires exactly the workspaces the app retires',()=>{
 const helper=readFileSync(new URL('./navigation-helper.mjs',import.meta.url),'utf8');
 const m=/export const RETIRED_WORKSPACES = (\[[\s\S]*?\]);/.exec(helper);
 assert.ok(m,'helper list missing');
 const list=JSON.parse(m[1].replaceAll("'",'"'));
 assert.deepEqual([...list].sort(),[...RETIRED_WORKSPACES].sort());
});

test('only the retired path in the helper changes the route itself',()=>{
 const helper=readFileSync(new URL('./navigation-helper.mjs',import.meta.url),'utf8');
 assert.equal(helper.split('history.pushState').length-1,1);
 assert.equal(/location\.hash\s*=[^=]/.test(helper),false,'nothing assigns location.hash');
 const at=helper.indexOf('history.pushState'),guard=helper.lastIndexOf('if (RETIRED_WORKSPACES.includes(workspace))',at);
 assert.ok(guard>0&&at-guard<900,'hash write is not inside the retired-workspace branch');
});
