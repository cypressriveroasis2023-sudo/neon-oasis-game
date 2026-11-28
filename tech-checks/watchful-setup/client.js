// Watchful setup check: talks to the server and uploads photos. The server checks everything again.
import {transferJpeg} from '../transfers/client.js';
import {selectionPayload} from './model.js';

export const BUCKET = 'techcheck-watchful-setup';

export function wsClient(context) {
  const actor = context.getSession()?.user?.id, role = context.getRole();
  const current = () => {
    const p = context.getProfile();
    return Boolean(actor && context.getSession()?.user?.id === actor && context.getRole() === role && p?.user_id === actor && p.active === true && !p.archived_at);
  };
  const assert = () => { if (!current()) throw new Error('Your signed-in account changed. Close this and open it again.'); };
  const rpc = async (name, args = {}) => {
    assert();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No signal right now. Nothing was lost: tap again when you have signal.');
    const {data, error} = await context.db.rpc(name, args);
    assert();
    if (error) throw new Error(cleanError(error.message));
    return data;
  };
  // Photos: re-drawn on a canvas (drops GPS and other EXIF), named by their own hash, so a retry never makes a duplicate.
  async function upload(check, fileOrBlob) {
    assert();
    const blob = fileOrBlob instanceof Blob && fileOrBlob.type === 'image/jpeg' && fileOrBlob.__wsClean ? fileOrBlob : await transferJpeg(fileOrBlob);
    const bytes = await blob.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    const path = actor + '/' + check + '/' + hash + '.jpg';
    const {error} = await context.db.storage.from(BUCKET).upload(path, blob, {contentType: 'image/jpeg', upsert: false});
    assert();
    if (error && String(error.statusCode) !== '409' && !/exists/i.test(error.message || '')) throw new Error('The photo did not upload. Check your signal and tap again. Nothing was lost.');
    return path;
  }
  const urls = new Map();
  return {
    actor, role, current,
    home: () => rpc('ws_home_v1'),
    findUnits: q => rpc('ws_find_units_v1', {p_q: q}),
    options: type => rpc('ws_options_v1', {p_unit_type: type}),
    start: ({unit, label, site, type, kind}) => rpc('ws_start_v1', {p_unit: unit, p_label: label, p_site: site || null, p_unit_type: type, p_kind: kind}),
    check: id => rpc('ws_check_v1', {p_check: id}),
    async saveSelection(check, draft) {
      for (const c of draft.cameras) if (!c.model && c.labelFile && !c.labelPath) c.labelPath = await upload(check, c.labelFile);
      if (draft.recorderLabelFile && !draft.recorderLabelPath) draft.recorderLabelPath = await upload(check, draft.recorderLabelFile);
      const p = selectionPayload(draft);
      return rpc('ws_save_selection_v1', {p_check: check, p_no_recorder: p.noRecorder, p_recorder: p.recorder,
        p_recorder_not_on_file: p.recorderNotOnFile, p_recorder_label_path: p.recorderLabelPath, p_system: p.system, p_cameras: p.cameras});
    },
    setItem: (item, result, {value = null, reason = null, note = null} = {}) =>
      rpc('ws_set_item_v1', {p_item: item, p_result: result, p_value: value, p_reason: reason, p_note: note}),
    async addPhoto(check, item, file) { return rpc('ws_add_photo_v1', {p_item: item, p_path: await upload(check, file)}); },
    async testMode(check, on, file) { return rpc('ws_test_mode_v1', {p_check: check, p_on: on, p_path: await upload(check, file)}); },
    async walk(check, camera, received, eventIso, file) {
      return rpc('ws_walk_v1', {p_camera: camera, p_received: received, p_event_time: received ? eventIso : null,
        p_path: received ? await upload(check, file) : null});
    },
    submit: check => rpc('ws_submit_v1', {p_check: check}),
    sendBack: (check, reason, items) => rpc('ws_send_back_v1', {p_check: check, p_reason: reason, p_items: items}),
    async signOff(check, x, y, file, override) {
      return rpc('ws_sign_off_v1', {p_check: check, p_x: x, p_y: y, p_path: await upload(check, file), p_override: override || null});
    },
    cancel: (check, reason) => rpc('ws_cancel_v1', {p_check: check, p_reason: reason}),
    waiveItem: (item, reason) => rpc('ws_waive_item_v1', {p_item: item, p_reason: reason}),
    waiveWalk: (camera, reason) => rpc('ws_waive_walk_v1', {p_camera: camera, p_reason: reason}),
    mapModel: (check, camera, model, reason) => rpc('ws_map_model_v1', {p_check: check, p_camera: camera, p_model: model, p_reason: reason}),
    hidePhoto: (evidence, reason) => rpc('ws_hide_photo_v1', {p_evidence: evidence, p_reason: reason}),
    quiet: () => rpc('ws_quiet_v1'),
    importRows: (readAt, rows) => rpc('ws_import_v1', {p_source: 'csv', p_read_at: readAt, p_rows: rows}),
    mapName: (row, camera, legacyUnit) => rpc('ws_map_name_v1', {p_site: row.site, p_unit: row.unit, p_camera: row.camera,
      p_unit_camera: camera || null, p_legacy_unit: legacyUnit || null}),
    ack: (alert, note) => rpc('ws_ack_v1', {p_alert: alert, p_note: note}),
    placement: (unit, placement, reason) => rpc('ws_placement_v1', {p_unit: unit, p_placement: placement, p_reason: reason}),
    async photoUrl(path) {
      if (urls.has(path)) return urls.get(path);
      assert();
      const {data, error} = await context.db.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) throw new Error('Photo not available.');
      urls.set(path, data.signedUrl); setTimeout(() => urls.delete(path), 240000);
      return data.signedUrl;
    },
  };
}

// Server messages are already written for people; drop database noise around them.
export function cleanError(message) {
  const m = String(message || '').replace(/^(ERROR|error):\s*/, '').replace(/\s*CONTEXT:.*$/s, '').trim();
  if (!m) return 'That did not save. Check your signal and try again.';
  if (/JWT|session/i.test(m)) return 'You are signed out. Sign in again; nothing you saved was lost.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No signal right now. Nothing was lost: tap again when you have signal.';
  return m.length > 400 ? m.slice(0, 400) + '…' : m;
}
