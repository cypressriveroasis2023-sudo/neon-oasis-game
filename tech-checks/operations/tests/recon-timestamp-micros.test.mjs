import test from 'node:test';import assert from 'node:assert/strict';
import {timestampMicros as micros} from './fixtures/recon-timestamp-micros.mjs';
test('strict timestamp comparator accepts same instants in UTC and non-UTC',()=>{
 for(const [a,b]of [
 ['2026-10-14T12:00:00.123456Z','2026-10-14T06:00:00.123456-06:00'],
 ['2026-01-01T00:00:00Z','2026-01-01T05:45:00.000000+05:45'],
 ['2026-03-08T08:30:00+00:00','2026-03-08T03:30:00-05:00'],
 ['2026-01-01T00:00:00Z','2025-12-31T18:00:00-06:00'],
 ])assert.equal(micros(a),micros(b));
});
test('strict timestamp comparator rejects changed instants and malformed dates',()=>{
 assert.equal(micros('2026-10-14T12:00:00.123457Z')-micros('2026-10-14T06:00:00.123456-06:00'),1n);
 assert.notEqual(micros('2026-10-14T12:00:00Z'),micros('2026-10-14T12:00:00-06:00'));
 for(const s of ['2026-02-29T00:00:00Z','2026-02-31T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00.1234567Z','2026-01-01T00:00:00','not a time','2026-01-01T00:00:00+24:00'])assert.throws(()=>micros(s),s);
});
