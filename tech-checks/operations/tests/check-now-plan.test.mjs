// What the board does with COS's answer when Refresh asks for a live check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readCheckNowPlan, checkNowWaitMs, CHECK_NOW_MAX_WAIT_MS} from '../src/checkNowPlan.ts';

const answer = (more = {}) => ({contract: 'COS_CHECK_NOW_STARTED_V1', started: true, reason: 'started', checkStartedAt: '2026-11-27T21:30:02.000Z', resultsBy: '2026-11-27T21:31:02.000Z', waitSeconds: 60, ...more});

test('a started check is waited on for as long as COS said, counted from when the answer arrived', () => {
  const plan = readCheckNowPlan(answer(), 1_000_000);
  assert.deepEqual(plan, {started: true, reason: 'started', waitSeconds: 60, receivedAt: 1_000_000});
  assert.equal(checkNowWaitMs(plan, 1_000_000), 60_000);
  assert.equal(checkNowWaitMs(plan, 1_042_000), 18_000);
  assert.equal(checkNowWaitMs(plan, 1_060_000), 0);
  assert.equal(checkNowWaitMs(plan, 1_999_999), 0, 'never negative');
});

test('the wait uses COS\'s count, not this device\'s clock against COS\'s timestamps', () => {
  // A phone an hour fast or slow waits the same 60 seconds.
  for (const received of [Date.parse('2026-11-27T20:30:02Z'), Date.parse('2026-11-27T22:30:02Z')]) {
    assert.equal(checkNowWaitMs(readCheckNowPlan(answer(), received), received), 60_000);
  }
});

test('a check already running, about to run or just finished is waited on, not started again', () => {
  for (const [reason, waitSeconds] of [['scheduled_check_running', 41], ['scheduled_check_due', 90], ['checked_recently', 0]]) {
    const plan = readCheckNowPlan(answer({started: false, reason, waitSeconds}), 5_000);
    assert.equal(plan.started, false); assert.equal(plan.reason, reason);
    assert.equal(checkNowWaitMs(plan, 5_000), waitSeconds * 1000);
  }
});

test('the wait is capped, and a clock that jumps backwards cannot stretch it', () => {
  const plan = readCheckNowPlan(answer({waitSeconds: 180}), 10_000);
  assert.equal(CHECK_NOW_MAX_WAIT_MS, 100_000);
  assert.equal(checkNowWaitMs(plan, 10_000), 100_000);
  assert.equal(checkNowWaitMs(plan, 0), 100_000);
  assert.equal(checkNowWaitMs(plan, -5_000_000), 100_000);
});

test('anything that is not COS\'s own answer is refused, so the board falls back to the saved reading and says so', () => {
  for (const bad of [null, undefined, 'started', [], {}, answer({contract: 'COS_CHECK_NOW_V1'}), answer({started: 'yes'}), answer({reason: 'soon'}),
    answer({started: false}), answer({started: true, reason: 'checked_recently'}), answer({waitSeconds: '60'}), answer({waitSeconds: 60.5}), answer({waitSeconds: -1}), answer({waitSeconds: 181}), {error: 'Only the Owner or approved IT can start a check.'}]) {
    assert.throws(() => readCheckNowPlan(bad, 0), /could not confirm/, JSON.stringify(bad));
  }
});
