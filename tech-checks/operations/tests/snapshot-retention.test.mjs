import test from 'node:test';import assert from 'node:assert/strict';
import {retainCompletedSnapshot} from '../src/snapshotRetention.ts';
const snapshot=(state='ready',sha='a')=>({readAt:'2026-11-03T20:00:00Z',fieldMap:{uploadInventory:{sourceSha256:sha},productConnectionsState:state}});
test('only unfinished and failed reads of the same source retain completed results',()=>{
 const previous=snapshot();for(const state of ['pending','error','timeout','rejected'])assert.equal(retainCompletedSnapshot(previous,snapshot(state)),true);
 assert.equal(retainCompletedSnapshot(previous,snapshot('ready')),false);
 assert.equal(retainCompletedSnapshot(previous,snapshot('error','b')),false);
 assert.equal(retainCompletedSnapshot(null,snapshot('error')),false);
});
