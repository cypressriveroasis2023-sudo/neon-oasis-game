import test from 'node:test';
import assert from 'node:assert/strict';
import { tvBoardLink, tvBoardOptions, tvBoardPages } from '../src/tvBoardData.ts';
import { dailyBoardCards } from '../src/dailyBoardData.ts';

test('TV links launch the authenticated host and omit unrelated URL state', () => {
  const host = 'https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/tech-checks/';
  assert.equal(tvBoardLink(host + '?token=private&fieldUnit=old#jobs?job=old', 'day', ''), host + '?tvBoard=1&simpleTv=1');
  assert.equal(tvBoardLink(host + 'operations/dist/index.html?mode=fleet', 'week', 'it'), host + '?tvBoard=1&simpleTv=1&tvScope=week&tvDepartment=it');
  assert.deepEqual(tvBoardOptions('?tvBoard=1&tvScope=week&tvDepartment=service'), {enabled:true,scope:'week',department:'service'});
  assert.deepEqual(tvBoardOptions('?tvBoard=yes&tvScope=invalid&tvDepartment=owner'), {enabled:false,scope:'day',department:''});
});

test('TV rotation includes every saved card exactly once across lane and card pages', () => {
  const jobs = Array.from({length:43}, (_, index) => ({id:String(index),customer:'Unit '+index,technician:'Tech '+(index%7),status:'assigned',priority:index%3?'medium':'high'}));
  const cards = dailyBoardCards(jobs, [], new Date('2026-10-12T15:00:00Z'));
  const readiness = Array.from({length:11}, (_, index) => ({userId:String(index),name:'Tech '+index,department:'it',status:'not started',result:{}}));
  for(const [width,height,lanes,perLane,readinessLimit] of [[1920,1080,3,2,6],[1440,900,2,2,4],[1024,768,2,1,2],[390,844,1,1,1]]) {
    const pages = tvBoardPages(cards, ['Unassigned','Tech 0','Tech 0'], readiness, width, height);
    const seen = pages.flatMap(page => page.kind==='work'?page.lanes.flatMap(lane=>lane.cards.map(card=>card.id)):[]);
    assert.equal(seen.length,cards.length);
    assert.deepEqual(new Set(seen),new Set(cards.map(card=>card.id)));
    assert.equal(pages.filter(page=>page.kind==='readiness').flatMap(page=>page.rows).length,readiness.length);
    for(const page of pages) {
      if(page.kind==='work'){assert.ok(page.lanes.length<=lanes);assert.ok(page.lanes.every(lane=>lane.cards.length>0&&lane.cards.length<=perLane));}
      else assert.ok(page.rows.length>0&&page.rows.length<=readinessLimit);
    }
  }
});

test('empty TV and readiness-only boards always have a valid display page', () => {
  assert.deepEqual(tvBoardPages([], ['Empty tech'], [], 1920,1080), [{kind:'work',lanes:[]}]);
  assert.equal(tvBoardPages([], [], [{userId:'1',name:'Technician',department:'service',status:'not started',result:{}}],1920,1080)[0].kind,'readiness');
});

test('shop tasks and jobs use the same Chicago day and overdue rules on TV', () => {
  const cards = dailyBoardCards([], [
    {id:'overdue',title:'Carry forward',dueAt:'2026-10-11 15:00',status:'assigned'},
    {id:'today',title:'Shop update',dueAt:'2026-10-12 10:00',instructions:'Saved update',status:'assigned'},
    {id:'future',title:'Next shift',dueAt:'2026-10-13 08:00',status:'assigned'},
    {id:'old-complete',title:'Old work',status:'complete',completedAt:'2026-10-11T15:00:00Z'},
  ], new Date('2026-10-12T15:00:00Z'));
  assert.deepEqual(new Set(cards.map(card=>card.record.id)), new Set(['overdue','today']));
  assert.equal(cards.find(card=>card.record.id==='overdue').lane,'attention');
});
