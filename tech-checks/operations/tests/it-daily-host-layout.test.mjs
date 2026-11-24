import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const host = readFileSync(new URL('../../it-daily-host.js', import.meta.url), 'utf8');

/**
 * The phone nav sits under the board, so anything that changes the board's
 * height after it is drawn moves the buttons under the tech's thumb. The board
 * is given its full height while it is still loading, which is also why the
 * browser test for that nav stopped missing its second tap.
 */
test('the IT phone board holds its height while it loads, so the nav below it cannot move', () => {
  assert.match(host, /\.cos-it-board-loading\{display:block;min-height:60dvh\}/);
  // The frame it reserves room for, and the overlay that sits inside that room.
  assert.match(host, /#cosITDailyFrame\{display:block;width:100%;height:60dvh/);
  assert.match(host, /pending\.style\.cssText='position:absolute;inset:0;z-index:1;margin:0;min-height:180px'/);
  // The nav is drawn after the board, which is what makes the reserved height matter.
  assert.match(host, /root\.replaceChildren\(board,\.\.\.\(value\.phone\?\[phoneNavigation\(value,generation\)\]:\[\]\)\)/);
});
