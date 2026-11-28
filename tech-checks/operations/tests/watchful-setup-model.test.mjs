import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../watchful-setup/model.js';

test('Central time in and out, daylight saving included', () => {
  assert.equal(M.ctToIso('2026-11-27', '15:04'), '2026-11-27T21:04:00.000Z');   // CST, UTC-6
  assert.equal(M.ctToIso('2026-07-04', '09:30'), '2026-07-04T14:30:00.000Z');   // CDT, UTC-5
  assert.throws(() => M.ctToIso('', '10:00'), /Enter the date and time/);
  assert.match(M.formatCT('2026-11-27T21:04:00Z'), /Fri, Nov 27, 3:04 PM CT/);
  const now = M.ctNowInputs(new Date('2026-11-28T15:07:00Z'));
  assert.deepEqual(now, {date: '2026-11-28', time: '09:07'});
});

test('CSV import: header names, quotes, times without a zone are Central', () => {
  const csv = 'Site,Unit,Camera,Last event,Read time\r\n"District West, Phase 3",Spotter 236HD,Spotter 236HD - Cam 001,11/27/2026 3:04 PM,2026-11-28 07:00\nYard,SS003,SS003_1,never,\n';
  const {rows, problems} = M.importRows(csv);
  assert.deepEqual(problems, []);
  assert.equal(rows[0].site, 'District West, Phase 3');
  assert.equal(rows[0].last_event_at, '2026-11-27T21:04:00.000Z');
  assert.equal(rows[0].read_at, '2026-11-28T13:00:00.000Z');
  assert.equal(rows[1].last_event_at, null);
  const bad = M.importRows('site,unit,camera,last event\nx,,cam,11/27/2026 1:00 PM\nx,u,c,banana');
  assert.equal(bad.rows.length, 0); assert.equal(bad.problems.length, 2);
  assert.throws(() => M.importRows('a,b\n1,2'), /header row needs/);
});

const choices = {
  nvr: [{id: 'n40', model: 'ALI-NR040F-1', role: 'nvr'}], nvr_channel: [{id: 'fb21', model: 'ALI-FB21-A', role: 'camera_on_nvr_channel'}],
  standalone: [{id: 'pb50', model: 'ALI-PB50-LUAIS-D', role: 'camera_standalone'}], ptz: [{id: 'pz40', model: 'ALI-PZ40-UZAI-D', role: 'camera_ptz'}],
  speaker: [{id: 'spk', model: 'model not read', role: 'ip_speaker'}]};

test('prefill: a Spotter gets its recorder from COS and 4 channels to confirm', () => {
  const d = M.prefill({key: 'SPOTTER 236', label: 'Spotter 236HD', recorderModel: 'ALI-NR040F-1', cameras: []}, {hasRecorder: true, choices}, 'Spotter (NVR trailer)');
  assert.equal(d.recorder.id, 'n40'); assert.equal(d.noRecorder, false);
  assert.equal(d.cameras.length, 4); assert.ok(d.cameras.every(c => c.role === 'camera_on_nvr_channel' && !c.model));
  assert.equal(d.cameras[0].name, 'Spotter 236HD ch1');
  assert.throws(() => M.selectionPayload(d), /pick its model/);
});

test('prefill: a Helios gets its cameras from COS, the PTZ as PTZ, plus its speaker', () => {
  const d = M.prefill({key: 'HELIOS 005', label: 'Helios 005', cameras: [
    {name: 'Helios 005 - Cam 001', model: 'ALI-PB50-LUAIS-D'}, {name: 'Helios 005 - Cam 002', model: 'ALI-PB50-LUAIS-D'}, {name: 'Helios 005 - Cam 003', model: 'ALI-PZ40-UZAI-D'}]},
  {hasRecorder: false, choices}, 'Helios');
  assert.deepEqual(d.cameras.map(c => c.role), ['camera_standalone', 'camera_standalone', 'camera_ptz', 'ip_speaker']);
  const p = M.selectionPayload(d);
  assert.equal(p.noRecorder, true); assert.equal(p.cameras.length, 4); assert.equal(p.cameras[2].model_id, 'pz40');
});

test('prefill: a model COS has that is not on the list needs typing and a label photo', () => {
  const d = M.prefill({key: 'SS9', label: 'SS9', cameras: [{name: 'SS9_1', model: 'ALI-FB81-LUA-D'}]}, {hasRecorder: true, choices}, 'Solar Spotter (SS)');
  assert.equal(d.cameras[0].notOnFile, 'ALI-FB81-LUA-D');
  assert.throws(() => M.selectionPayload(d), /photo of the model label/);
  d.cameras[0].labelPath = 'x';
  assert.equal(M.selectionPayload(d).cameras[0].not_on_file, 'ALI-FB81-LUA-D');
});

test('prefill: Avigilon units list cameras against the system, nothing to set on the device', () => {
  const sys = {id: 'av', model: 'model not recorded in COS/Watchful', brand: 'Avigilon', role: 'closed_system'};
  const d = M.prefill({key: 'SNIPER 302', label: 'Sniper 302', cameras: []}, {hasRecorder: false, choices: {closed: [sys]}}, 'Sniper');
  assert.equal(d.system.id, 'av'); assert.equal(d.cameras.length, 2);
  assert.deepEqual(M.selectionPayload(d).cameras.map(c => c.model_id), ['av', 'av']);
});

test('selection: duplicate camera names are refused in plain words', () => {
  const d = {noRecorder: true, recorder: null, recorderNotOnFile: '', cameras: [
    {role: 'camera_standalone', model: choices.standalone[0], name: 'Cam'}, {role: 'camera_standalone', model: choices.standalone[0], name: 'cam'}]};
  assert.throws(() => M.selectionPayload(d), /both called/);
});

test('next step: steps in order, a missing photo before moving on, then the walk test, then send', () => {
  const item = (id, result, extra = {}) => ({id, code: id, result, standardStatus: 'CONFIRMED', evidence: 'optional', photos: [], reopened: false, ...extra});
  const chk = {status: 'in_progress', canEdit: true, blockers: ['x'], testMode: {on: false},
    selection: {cameras: [{id: 'c1', walk: {passed: false, waived: false}}]},
    sections: [{title: 'Unit', items: [item('U1', 'done'), item('N5', 'pending', {standardStatus: 'PLACEHOLDER'}), item('P2', 'done', {evidence: 'required'}), item('U2', 'pending')]}]};
  assert.equal(M.nextStep(chk).item.id, 'U2', 'placeholders are skipped');
  chk.sections[0].items[3].result = 'done';
  assert.equal(M.nextStep(chk).item.id, 'P2', 'a required photo is the next thing');
  chk.sections[0].items[2].photos = [{path: 'p'}];
  assert.equal(M.nextStep(chk).kind, 'walk');
  chk.selection.cameras[0].walk.passed = true; chk.blockers = [];
  assert.equal(M.nextStep(chk).kind, 'submit');
  assert.deepEqual(M.progress(chk), {done: 3, total: 3, walked: 1, cameras: 1, percent: 100});
});

test('one screenshot covers the steps in its group', () => {
  const g = (code, photos) => ({id: code, code, result: 'done', standardStatus: 'CONFIRMED', evidence: 'required', evidenceGroup: 'mail_page', cameraId: 'c1', photos});
  const chk = {sections: [{title: 'Camera 1', items: [g('M1', []), g('M2', [{path: 'p'}]), g('M3', [])]}]};
  assert.equal(M.photoNeeded(chk, chk.sections[0].items[0]), false);
});
