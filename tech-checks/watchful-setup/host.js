// Watchful setup check: proves every camera on a unit sends an event to Watchful before the unit goes live.
// Phone first: one question per screen, big buttons, and a "Do the next step" button so nobody has to hunt.
// Service, IT and the owner do the steps; IT or the owner check Watchful's camera count and sign off.
// The server checks every rule again; nothing here can skip one.
import {wsClient} from './client.js?v=ws-v1';
import * as M from './model.js?v=ws-v1';

const node = (tag, text = '', cls = '') => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, run, cls = 'ws-big') => { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', run); return b; };
const first = name => (name || '').split(' ')[0] || name || 'someone';
const KINDS = [['new', 'New install', 'Going out to a site for the first time'],
  ['reinstall', 'Re-install', 'Moved to a new site, or swapped'],
  ['recommission', 'Re-check a unit already out there', 'Bring a unit that is already live up to the standard']];
const RESULT_ICON = {done: '✓', na: '–', waived: '✓', cannot_complete: '!', pending: '○'};

export function openWatchful(context, {onChange = () => {}, start = null} = {}) {
  const client = wsClient(context);
  const dialog = node('dialog', '', 'ws-dialog'), bar = node('div', '', 'ws-bar'), status = node('p', '', 'ws-status'), body = node('div', '', 'ws-body');
  const back = button('‹', () => goBack(), 'ws-icon'); back.setAttribute('aria-label', 'Back');
  const closeButton = button('✕', () => close(), 'ws-icon'); closeButton.setAttribute('aria-label', 'Close');
  bar.append(back, node('div', 'WATCHFUL SETUP CHECK', 'ws-brand'), closeButton);
  dialog.append(bar, status, body); document.body.append(dialog);
  dialog.addEventListener('click', e => e.stopPropagation());
  let alive = true, busy = false, screen = null, flash = ''; const history = [];
  const valid = () => alive && client.current() && dialog.isConnected;
  const tell = (text, kind = '') => {
    if (!valid()) return;
    status.textContent = text; status.className = 'ws-status' + (kind ? ' ws-' + kind : '');
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    if (kind === 'error') dialog.scrollTop = 0;
  };
  function close() { if (busy) return; alive = false; dialog.close(); dialog.remove(); }
  dialog.addEventListener('cancel', e => { e.preventDefault(); goBack(); });
  dialog.showModal();

  async function run(label, work) {
    if (busy) return undefined; busy = true; tell(label);
    for (const b of dialog.querySelectorAll('button, input, textarea, select')) b.disabled = true;
    try { const out = await work(); if (!valid()) return undefined; tell(''); if (flash) { tell(flash, 'ok'); flash = ''; } onChange(); return out === undefined || out === null || out === '' ? true : out; }
    catch (e) { tell(e.message, 'error'); return undefined; }
    finally { busy = false; if (valid()) for (const b of dialog.querySelectorAll('button, input, textarea, select')) b.disabled = false; }
  }
  // screens are functions; go() pushes, goBack() pops
  function show(fn) { screen = fn; body.replaceChildren(); dialog.scrollTop = 0; fn(); back.hidden = !history.length; }
  function go(fn) { if (screen) history.push(screen); show(fn); }
  function goBack() { if (busy) return; tell(''); const prev = history.pop(); if (prev) show(prev); else close(); }
  // a message that survives the next screen's loading
  function home(message = '') { history.length = 0; flash = message; show(homeScreen); if (message) tell(message, 'ok'); }

  const title = (text, small = '') => { if (small) body.append(node('p', small, 'ws-kicker')); body.append(node('h1', text, 'ws-title')); };
  const note = (text, cls = '') => body.append(node('p', text, 'ws-note ' + cls));
  const card = (cls = '') => { const c = node('section', '', 'ws-card ' + cls); body.append(c); return c; };
  function photoButton(label, onFile, cls = 'ws-big ws-photo') {
    const input = node('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.className = 'ws-file';
    input.setAttribute('aria-label', label);
    const wrap = node('label', '', cls); wrap.append(node('span', '📷 ' + label), input);
    input.addEventListener('change', () => { const f = input.files?.[0]; input.value = ''; if (f) onFile(f); });
    return wrap;
  }
  function thumbs(paths) {
    const row = node('div', '', 'ws-thumbs');
    for (const p of paths.slice(0, 6)) {
      const a = node('a', '', 'ws-thumb'); a.target = '_blank'; a.rel = 'noopener'; a.textContent = '📷';
      client.photoUrl(p).then(url => { if (!valid()) return; a.href = url; const img = node('img'); img.alt = 'Photo'; img.src = url; a.replaceChildren(img); }).catch(() => {});
      row.append(a);
    }
    return row;
  }
  function textBox(placeholder, value = '', rows = 2, max = 500) {
    const t = node('textarea'); t.rows = rows; t.maxLength = max; t.placeholder = placeholder; t.value = value; t.setAttribute('aria-label', placeholder);
    return t;
  }
  function field(labelText, input) { const l = node('label', '', 'ws-field'); l.append(node('span', labelText), input); return l; }
  function bar_(pct) { const b = node('div', '', 'ws-progress'); const f = node('div'); f.style.width = Math.max(0, Math.min(100, pct)) + '%'; b.append(f); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuenow', String(pct)); return b; }

  // ================================================================ home
  let homeData = null;
  function homeScreen() {
    title('Watchful setup check');
    note('Every camera has to prove it sends an event to Watchful before a unit goes live. This walks you through it one step at a time.');
    body.append(button('➕ Start a check on a unit', () => go(findUnitScreen), 'ws-big ws-go'));
    const list = node('div'); body.append(list);
    const paint = d => {
      list.replaceChildren();
      const me = d.me;
      const mine = d.open.filter(c => c.status === 'returned');
      for (const c of mine) list.append(checkCard(c, 'Sent back: ' + (c.returnedReason || 'see the steps marked'), 'ws-alert'));
      if (me.canOffice && d.waiting.length) {
        list.append(node('h2', 'Waiting for your office check', 'ws-h2'));
        for (const c of d.waiting) list.append(checkCard(c, 'Sent by ' + (c.techSignedBy || 'the tech') + '. Check Watchful\'s camera count and sign off.', 'ws-alert'));
      }
      const open = d.open.filter(c => c.status !== 'returned');
      if (open.length) { list.append(node('h2', 'In progress', 'ws-h2')); for (const c of open) list.append(checkCard(c)); }
      if (!me.canOffice && d.waiting.length) { list.append(node('h2', 'With the office', 'ws-h2')); for (const c of d.waiting) list.append(checkCard(c)); }
      if (me.canOffice && d.quiet) {
        const q = d.quiet, bad = q.quiet + q.neverSent;
        const b = button('📡 Quiet cameras' + (bad ? ' — ' + bad + ' need a look' : '') + (q.unknown ? ' · ' + q.unknown + ' unknown' : ''), () => go(quietScreen), 'ws-big ' + (bad ? 'ws-warnbtn' : ''));
        list.append(b);
      }
      if (d.recent.length) {
        const c = node('section', '', 'ws-card ws-quiet'); c.append(node('h2', 'Done and live'));
        for (const r of d.recent) c.append(node('p', '✓ ' + r.unitLabel + ' — signed off by ' + (r.officeSignedBy || 'the office') + ', ' + M.formatCT(r.officeSignedAt)));
        list.append(c);
      }
      if (!d.open.length && !d.waiting.length) list.append(node('p', 'No checks open right now.', 'ws-note'));
    };
    if (homeData) paint(homeData);
    run('Loading…', async () => { homeData = await client.home(); }).then(ok => { if (ok && screen === homeScreen) paint(homeData); });
  }
  function checkCard(c, line = '', cls = '') {
    const box = node('section', '', 'ws-card ' + cls);
    const head = node('div', '', 'ws-row'); head.append(node('h2', c.unitLabel), node('span', c.statusText, 'ws-chip ws-chip-' + c.status));
    box.append(head, node('p', c.unitType + (c.site ? ' · ' + c.site : ''), 'ws-sub'));
    if (c.total) { box.append(bar_(Math.round(100 * (c.done + c.passed) / (c.total + c.cameras)))); box.append(node('p', c.done + ' of ' + c.total + ' steps · ' + c.passed + ' of ' + c.cameras + ' cameras walk-tested', 'ws-sub')); }
    if (line) box.append(node('p', line));
    box.append(button(c.status === 'awaiting_office' && homeData?.me.canOffice ? 'Check it' : 'Open ' + c.unitLabel, () => openCheck(c.id), 'ws-big ws-go'));
    return box;
  }

  // ================================================================ start: unit, type, site, why
  const start_ = {unit: null, type: '', site: '', kind: 'new'};
  function findUnitScreen() {
    title('Which unit?', 'Step 1 of 4');
    const input = node('input'); input.type = 'search'; input.placeholder = 'Type the unit number, like 236 or SS003'; input.className = 'ws-input';
    input.setAttribute('aria-label', 'Unit number'); input.autocomplete = 'off';
    body.append(input);
    const results = node('div'); body.append(results);
    let timer = 0, seq = 0;
    const search = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim(), mine = ++seq;
        if (q.length < 2) { results.replaceChildren(node('p', 'Type at least 2 letters or numbers.', 'ws-note')); return; }
        try {
          const found = await client.findUnits(q);
          if (mine !== seq || !valid()) return;
          results.replaceChildren();
          for (const u of found) {
            const b = button('', () => {
              if (u.openCheck) { openCheck(u.openCheck); return; }
              start_.unit = u; start_.type = u.suggestedType || ''; go(typeScreen);
            }, 'ws-big ws-pick');
            b.append(node('strong', u.label), node('span', (u.suggestedType || u.family || '') + (u.openCheck ? ' · check open — continue it' : u.signedOff ? ' · checked before' : ''), 'ws-pick-sub'));
            results.append(b);
          }
          const typed = q.toUpperCase();
          results.append(node('p', found.length ? 'Not the right one?' : 'COS has no unit called "' + q + '".', 'ws-note'));
          results.append(button('Use "' + typed + '" exactly as typed', () => { start_.unit = {key: typed, label: q, cameras: []}; start_.type = ''; go(typeScreen); }, 'ws-big'));
        } catch (e) { if (mine === seq) tell(e.message, 'error'); }
      }, 300);
    };
    input.addEventListener('input', search);
    setTimeout(() => input.focus(), 50);
  }
  function typeScreen() {
    title('What kind of unit is ' + start_.unit.label + '?', 'Step 2 of 4');
    if (start_.unit.suggestedType) note('COS has it as a ' + start_.unit.suggestedType + '. Tap it if that is right.');
    const types = homeData?.types || ['Spotter (NVR trailer)', 'Solar Spotter (SS)', 'Helios', 'Ranger', 'Sniper', 'CAM V / RSU', 'Recon II (Reconeyez)', 'Recon (Reconeyez)', 'Wall-E'];
    const ordered = start_.unit.suggestedType ? [start_.unit.suggestedType, ...types.filter(t => t !== start_.unit.suggestedType)] : types;
    for (const t of ordered) body.append(button(t + (t === start_.unit.suggestedType ? '  ✓ COS says' : ''), () => { start_.type = t; go(siteScreen); }, 'ws-big ws-pick' + (t === start_.unit.suggestedType ? ' ws-on' : '')));
  }
  function siteScreen() {
    title('What site is it at?', 'Step 3 of 4');
    const input = node('input'); input.className = 'ws-input'; input.placeholder = 'Site name, like District West Phase 3'; input.value = start_.site; input.maxLength = 120;
    input.setAttribute('aria-label', 'Site name');
    body.append(input, node('p', 'Use the same name the site has in Watchful. Leave it empty if the unit is still in the shop.', 'ws-note'));
    body.append(button('Next', () => { start_.site = input.value.trim(); go(kindScreen); }, 'ws-big ws-go'));
  }
  function kindScreen() {
    title('Why are you checking it?', 'Step 4 of 4');
    for (const [k, label, sub] of KINDS) {
      const b = button('', () => { start_.kind = k; begin(); }, 'ws-big ws-pick'); b.append(node('strong', label), node('span', sub, 'ws-pick-sub')); body.append(b);
    }
  }
  async function begin() {
    const chk = await run('Starting the check…', () => client.start({unit: start_.unit.key, label: start_.unit.label, site: start_.site, type: start_.type, kind: start_.kind}));
    if (!chk) return;
    history.length = 0; homeData = null;
    if (chk.status === 'draft' || !chk.selection.cameras.length) startEquipment(chk); else { current = chk; show(overviewScreen); }
  }

  // ================================================================ open a check
  let current = null;
  async function openCheck(id) {
    const chk = await run('Opening…', () => client.check(id));
    if (!chk) return;
    current = chk;
    if (chk.status === 'awaiting_office' && chk.canOffice) go(officeScreen);
    else if (chk.status === 'draft' || !chk.selection.cameras.length) startEquipment(chk);
    else go(overviewScreen);
  }
  const refresh = async () => { current = await client.check(current.id); return current; };

  // ================================================================ equipment
  let draft = null, options = null;
  async function startEquipment(chk) {
    current = chk;
    const unit = start_.unit && start_.unit.key === chk.unitKey ? start_.unit : ((await run('Loading…', () => client.findUnits(chk.unitKey))) || []).find(u => u.key === chk.unitKey) || {key: chk.unitKey, label: chk.unitLabel, cameras: []};
    options = await run('Loading the models…', () => client.options(chk.unitType));
    if (!options) return;
    draft = M.prefill(unit, options, chk.unitType);
    go(!options.hasRecorder ? camerasScreen : draft.recorder && draft.recorderFromCos ? recorderScreen : recorderPickScreen);
  }
  const noRecorderButton = () => button('This unit has no recorder (cameras only)', () => { draft.noRecorder = true; draft.recorder = null; draft.recorderNotOnFile = '';
    draft.cameras = draft.cameras.map(c => c.role === 'camera_on_nvr_channel' ? {...c, role: 'camera_standalone', model: null} : c); go(camerasScreen); }, 'ws-big ws-quietbtn');
  function recorderScreen() {
    title('The recorder (NVR)', current.unitLabel);
    const c = card('ws-cos'); c.append(node('p', 'COS has this recorder on file as'), node('div', draft.recorder.model, 'ws-model'));
    body.append(node('p', 'Look at the label on the recorder. Does it say ' + draft.recorder.model + '?', 'ws-q'));
    body.append(button('Yes, the label says ' + draft.recorder.model, () => { draft.noRecorder = false; go(camerasScreen); }, 'ws-big ws-go'));
    body.append(button('No, it says something else', () => { draft.recorder = null; go(recorderPickScreen); }, 'ws-big'));
    body.append(noRecorderButton());
  }
  function recorderPickScreen() {
    title('Which recorder model is it?', current.unitLabel);
    note('Read the model off the label on the recorder.');
    for (const m of options.choices.nvr || []) body.append(button(m.model, () => { draft.recorder = m; draft.noRecorder = false; draft.recorderNotOnFile = '';
      draft.cameras = draft.cameras.map(c => c.role === 'camera_standalone' && !c.fromCos ? {...c, role: 'camera_on_nvr_channel', model: null} : c); go(camerasScreen); }, 'ws-big ws-pick'));
    body.append(button('Not on the list', () => go(recorderNotOnFileScreen), 'ws-big'));
    if (draft.recorderFromCos && !draft.recorder) note('COS has "' + draft.recorderFromCos + '" on file for this unit, which is not on the list. Check the label.');
    body.append(noRecorderButton());
  }
  function recorderNotOnFileScreen() {
    title('Type the recorder model exactly', current.unitLabel);
    note('Type it exactly as printed on the label, then take a photo of the label. The office adds it to the list; until then the general standard is used.');
    const input = node('input'); input.className = 'ws-input'; input.value = draft.recorderNotOnFile || draft.recorderFromCos || ''; input.maxLength = 60; input.placeholder = 'Model on the label';
    input.setAttribute('aria-label', 'Recorder model on the label');
    body.append(input);
    if (draft.recorderLabelFile) body.append(node('p', '✓ Label photo taken', 'ws-good'));
    body.append(photoButton(draft.recorderLabelFile ? 'Take the label photo again' : 'Take a photo of the label', f => { draft.recorderLabelFile = f; draft.recorderLabelPath = null; draft.recorderNotOnFile = input.value; show(recorderNotOnFileScreen); }));
    body.append(button('Next', () => { draft.recorderNotOnFile = input.value.trim(); draft.recorder = null; draft.noRecorder = false;
      if (!draft.recorderNotOnFile) return tell('Type the model first.', 'error');
      if (!draft.recorderLabelFile) return tell('Take a photo of the label first.', 'error'); go(camerasScreen); }, 'ws-big ws-go'));
  }
  const rowChoices = row => {
    const ch = options.choices;
    if (draft.system) return [draft.system];
    if (row.role === 'ip_speaker') return ch.speaker || [];
    if (!draft.noRecorder) return ch.nvr_channel || [];
    return [...(ch.standalone || []), ...(ch.ptz || []), ...(ch.speaker || [])];
  };
  function camerasScreen() {
    title(draft.system ? 'Cameras on ' + current.unitLabel : draft.noRecorder ? 'The cameras' : 'Cameras plugged into the recorder', current.unitLabel);
    if (draft.system) note(draft.system.brand + ': nothing to set on the device here. Never log in to it. Just list the cameras so each one gets a walk test.');
    else note('One row per camera. Check each model against its label. Tap a row to change it.');
    draft.cameras.forEach((c, i) => {
      const box = card(c.model ? '' : 'ws-alert');
      const head = node('div', '', 'ws-row'); head.append(node('h2', M.roleWord(c.role) + ' ' + (i + 1)));
      if (draft.cameras.length > 1) head.append(button('Remove', () => { draft.cameras.splice(i, 1); show(camerasScreen); }, 'ws-small'));
      box.append(head);
      const name = node('input'); name.className = 'ws-input'; name.value = c.name; name.maxLength = 80; name.setAttribute('aria-label', 'Camera ' + (i + 1) + ' name in Watchful');
      name.addEventListener('input', () => { c.name = name.value; });
      box.append(field('Name (as it shows in Watchful)', name));
      const model = c.model ? c.model.model : c.notOnFile ? c.notOnFile + ' (not on the list' + (c.labelFile ? ', label photo taken' : ', label photo needed') + ')' : 'Pick the model';
      box.append(node('p', 'Model: ' + model + (c.fromCos && c.model ? '  ✓ from COS' : ''), c.model ? 'ws-sub' : 'ws-bad'));
      if (!draft.system) box.append(button(c.model ? 'Change model' : 'Pick the model', () => { rowEdit = i; go(rowModelScreen); }, 'ws-big'));
    });
    if (!draft.system || draft.cameras.length < 8) body.append(button('+ Add a camera', () => {
      const n = draft.cameras.length + 1, role = draft.system ? draft.system.role : draft.noRecorder ? 'camera_standalone' : 'camera_on_nvr_channel';
      draft.cameras.push({position: n, role, model: draft.system || null, notOnFile: '', name: current.unitLabel + (draft.noRecorder || draft.system ? ' Cam ' : ' ch') + n}); show(camerasScreen);
    }, 'ws-big ws-quietbtn'));
    body.append(button('Next: check the list', () => { try { checkDraft(); go(confirmScreen); } catch (e) { tell(e.message, 'error'); } }, 'ws-big ws-go'));
  }
  // same checks as the save, minus photos still waiting to upload
  function checkDraft() {
    const copy = {...draft, recorderLabelPath: draft.recorderLabelPath || (draft.recorderLabelFile ? 'pending' : null),
      cameras: draft.cameras.map(c => ({...c, labelPath: c.labelPath || (c.labelFile ? 'pending' : null)}))};
    M.selectionPayload(copy);
  }
  let rowEdit = 0;
  function rowModelScreen() {
    const c = draft.cameras[rowEdit];
    title('Which model is ' + (c.name || M.roleWord(c.role) + ' ' + (rowEdit + 1)) + '?', current.unitLabel);
    note('Read it off the label on the camera.');
    for (const m of rowChoices(c)) body.append(button(m.model + (m.role === 'camera_ptz' ? '  (PTZ)' : m.role === 'ip_speaker' ? '  (IP speaker)' : ''),
      () => { c.model = m; c.role = m.role; c.notOnFile = ''; c.labelFile = null; c.labelPath = null; goBack(); }, 'ws-big ws-pick' + (c.model?.id === m.id ? ' ws-on' : '')));
    body.append(button('Not on the list', () => go(rowNotOnFileScreen), 'ws-big'));
  }
  function rowNotOnFileScreen() {
    const c = draft.cameras[rowEdit];
    title('Type the camera model exactly', c.name);
    note('Type it exactly as printed on the label, then take a photo of the label. The office adds it to the list; until then the general camera standard is used.');
    const input = node('input'); input.className = 'ws-input'; input.value = c.notOnFile || ''; input.maxLength = 60; input.placeholder = 'Model on the label';
    input.setAttribute('aria-label', 'Camera model on the label'); body.append(input);
    const kind = node('select'); kind.className = 'ws-input'; kind.setAttribute('aria-label', 'What kind of camera');
    for (const [v, t] of [['camera_standalone', 'Fixed camera'], ['camera_ptz', 'PTZ camera (moves)'], ['camera_on_nvr_channel', 'Camera on a recorder channel'], ['ip_speaker', 'IP speaker']]) {
      const o = node('option', t); o.value = v; o.selected = c.role === v; kind.append(o);
    }
    body.append(field('What kind is it?', kind));
    if (c.labelFile) body.append(node('p', '✓ Label photo taken', 'ws-good'));
    body.append(photoButton(c.labelFile ? 'Take the label photo again' : 'Take a photo of the label', f => { c.labelFile = f; c.labelPath = null; c.notOnFile = input.value; c.role = kind.value; show(rowNotOnFileScreen); }));
    body.append(button('Save this camera', () => {
      c.notOnFile = input.value.trim(); c.role = kind.value;
      if (!c.notOnFile) return tell('Type the model first.', 'error');
      if (!c.labelFile) return tell('Take a photo of the label first.', 'error');
      c.model = null; history.pop(); goBack();
    }, 'ws-big ws-go'));
  }
  function confirmScreen() {
    title('Is this right?', current.unitLabel);
    const c = card();
    if (draft.system) c.append(node('p', 'System: ' + draft.system.brand + ' (Watchful side only)'));
    else if (draft.noRecorder) c.append(node('p', 'No recorder: cameras only'));
    else c.append(node('p', 'Recorder: ' + (draft.recorder?.model || draft.recorderNotOnFile + ' (not on the list)')));
    for (const [i, cam] of draft.cameras.entries()) c.append(node('p', (i + 1) + '. ' + cam.name + ' — ' + (cam.model?.model || cam.notOnFile + ' (not on the list)')));
    const n = draft.cameras.filter(x => x.role !== 'ip_speaker').length;
    note('Watchful should end up showing ' + n + ' camera' + (n === 1 ? '' : 's') + ' for this unit. The checklist is built from these models.');
    body.append(button('Yes, build the checklist', async () => {
      const chk = await run('Saving and building the checklist…', () => client.saveSelection(current.id, draft));
      if (!chk) return;
      current = chk; history.length = 0; show(overviewScreen); tell('Checklist ready. Tap "Do the next step" and follow along.', 'ok');
    }, 'ws-big ws-go'));
    body.append(button('Change something', () => goBack(), 'ws-big'));
  }

  // ================================================================ checklist overview
  function overviewScreen() {
    const chk = current, p = M.progress(chk), next = M.nextStep(chk);
    const head = node('div', '', 'ws-row'); head.append(node('h1', chk.unitLabel, 'ws-title'), node('span', chk.statusText, 'ws-chip ws-chip-' + chk.status));
    body.append(head, node('p', chk.unitType + (chk.site ? ' · ' + chk.site : '') + ' · started by ' + chk.startedBy, 'ws-sub'));
    body.append(bar_(p.percent), node('p', p.done + ' of ' + p.total + ' steps done · ' + p.walked + ' of ' + p.cameras + ' cameras walk-tested', 'ws-sub'));
    if (chk.status === 'returned') { const c = card('ws-alert'); c.append(node('h2', 'The office sent this back'), node('p', chk.returnedReason || '')); c.append(node('p', 'Only the steps marked ↩ need doing again. Then walk-test again and send it back.', 'ws-sub')); }
    if (chk.status === 'awaiting_office') card('ws-cos').append(node('p', 'Sent to the office' + (chk.techSignedBy ? ' by ' + chk.techSignedBy : '') + '. IT or the owner checks Watchful\'s camera count and signs off.'));
    if (chk.status === 'live') card('ws-good-card').append(node('p', '✓ Done and live. Signed off by ' + chk.officeSignedBy + ', ' + M.formatCT(chk.officeSignedAt) + '.'));
    if (M.allItems(chk).some(i => i.standardStatus === 'UNCONFIRMED') && chk.notices?.standard_unconfirmed) {
      const d = node('details', '', 'ws-amber'); d.append(node('summary', '⚠ Some settings are not confirmed yet — tap to read why'), node('p', chk.notices.standard_unconfirmed.body));
      d.append(node('p', 'Do them anyway; they count. The walk test is what proves the camera works.')); body.append(d);
    }
    const nextLabel = {equipment: 'Pick the equipment', item: 'Do the next step', walk: 'Walk test the cameras', submit: 'Send it to the office', stuck: 'A step needs the owner',
      blocked: 'See what is left', office: 'Check it and sign off', waiting: '', done: '', cancelled: ''}[next.kind];
    if (nextLabel) body.append(button('▶ ' + nextLabel, () => doNext(), 'ws-big ws-go ws-next'));
    for (const s of chk.sections) {
      const d = node('details', '', 'ws-section'); const items = s.items, open = items.filter(i => i.result === 'pending' && i.standardStatus !== 'PLACEHOLDER').length;
      d.open = open > 0 && chk.canEdit && (chk.status !== 'returned' || items.some(i => i.reopened));
      d.append(node('summary', s.title + (open ? ' — ' + open + ' to do' : ' — done ✓')));
      for (const it of items) {
        const row = button('', () => { itemId = it.id; go(itemScreen); }, 'ws-item ws-item-' + (it.standardStatus === 'PLACEHOLDER' ? 'grey' : it.result) + (it.reopened ? ' ws-reopened' : ''));
        row.append(node('span', it.standardStatus === 'PLACEHOLDER' ? '·' : it.reopened && it.result === 'pending' ? '↩' : RESULT_ICON[it.result], 'ws-item-icon'),
          node('span', it.title + (it.value ? ': ' + it.value : ''), 'ws-item-title'),
          node('span', M.photoNeeded(chk, it) ? '📷 needed' : it.standardStatus === 'PLACEHOLDER' ? 'pending standard' : it.standardStatus === 'UNCONFIRMED' ? 'unconfirmed' : '', 'ws-item-tag'));
        d.append(row);
      }
      body.append(d);
    }
    const w = card(); w.append(node('h2', 'Walk test in Watchful'));
    for (const c of chk.selection.cameras.filter(c => c.walk)) w.append(node('p', (c.walk.passed ? '✓ ' : c.walk.waived ? '✓ waived — ' : '○ ') + c.name + (c.walk.failed ? ' (' + c.walk.failed + ' tries with no event)' : '')));
    if (chk.canEdit) w.append(button('Open the walk test', () => go(walkScreen), 'ws-big'));
    if (chk.canEdit && chk.blockers.length) {
      const d = node('details', '', 'ws-section'); d.append(node('summary', 'What is left before it can go to the office (' + chk.blockers.length + ')'));
      for (const b of chk.blockers) d.append(node('p', '• ' + b, 'ws-sub'));
      body.append(d);
    }
    const me = chk.me;
    if (['draft', 'in_progress', 'returned', 'awaiting_office'].includes(chk.status) && me.canTech) {
      body.append(button('Cancel this check', () => go(cancelScreen), 'ws-small ws-quietbtn'));
    }
  }
  function doNext() {
    const next = M.nextStep(current);
    if (next.kind === 'equipment') return startEquipment(current);
    if (next.kind === 'item' || next.kind === 'stuck') { itemId = next.item.id; return go(itemScreen); }
    if (next.kind === 'walk') return go(walkScreen);
    if (next.kind === 'submit' || next.kind === 'blocked') return go(submitScreen);
    if (next.kind === 'office') return go(officeScreen);
  }
  function cancelScreen() {
    title('Cancel the check on ' + current.unitLabel + '?');
    note('Everything done so far is kept in the history. The unit is not changed anywhere.');
    const why = textBox('Why? For example: unit went back to the shop'); body.append(why);
    body.append(button('Yes, cancel it', async () => { if (await run('Cancelling…', () => client.cancel(current.id, why.value))) home('Cancelled.'); }, 'ws-big ws-stop'));
  }

  // ================================================================ one step
  let itemId = null;
  function itemScreen() {
    const chk = current, it = M.allItems(chk).find(i => i.id === itemId);
    if (!it) return home();
    const can = M.editable(chk, it);
    title(it.title, it.section + ' · ' + it.code);
    if (it.standardStatus === 'PLACEHOLDER') {
      card('ws-grey').append(node('p', 'Pending standard. Nothing to do here yet: this step is filled in once the Watchful event check is confirmed.'));
      body.append(button('Next', () => advance(), 'ws-big ws-go')); return;
    }
    const st = card('ws-standard'); st.append(node('p', 'What it should be', 'ws-kicker'), node('p', it.standard || '', 'ws-std'));
    if (it.standardStatus === 'UNCONFIRMED') st.append(node('span', 'Standard unconfirmed', 'ws-badge-amber'));
    if (it.instructions) note(it.instructions, it.evidence === 'never' ? 'ws-bad' : '');
    if (it.help) { const d = node('details', '', 'ws-help'); d.append(node('summary', 'What working units have'), node('p', it.help)); body.append(d); }
    if (it.reopened && it.returnedNote) card('ws-alert').append(node('p', 'Office: ' + it.returnedNote));
    if (it.result !== 'pending') {
      const what = {done: 'Done', na: 'Doesn\'t apply', cannot_complete: 'Can\'t do it', waived: 'Waived by the owner'}[it.result];
      card('ws-cos').append(node('p', what + (it.value ? ': ' + it.value : '') + (it.doneBy ? ' — ' + it.doneBy + ', ' + M.formatCT(it.doneAt) : '') + (it.reason ? '. Why: ' + it.reason : '') + (it.waivedReason ? '. Owner: ' + it.waivedReason : '')));
    }
    const noteBox = textBox('Note (optional)', it.note || '');
    if (can) {
      if (it.valueType !== 'none' && it.options?.length) {
        body.append(node('p', it.valueType === 'hours' ? 'What is the arming schedule set to?' : 'What is it set to?', 'ws-q'));
        for (const o of it.options) body.append(button(o, () => save('done', {value: o}), 'ws-big ws-pick' + (it.value === o ? ' ws-on' : '')));
      } else body.append(button(it.result === 'done' ? '✓ Done (tap to save again)' : '✓ Done — it is set like this', () => save('done'), 'ws-big ws-go'));
    }
    if (it.evidence === 'never') body.append(node('p', '🚫 Do not photograph this field.', 'ws-bad ws-q'));
    else if (it.evidence !== 'optional' || it.photos.length) {
      const need = M.photoNeeded(chk, it);
      const covered = it.evidence === 'required' && !it.photos.length && it.result === 'done' && !need;
      body.append(node('p', it.evidence === 'required' ? (covered ? '📷 Photo: covered by the same screenshot on another step' : '📷 Photo needed') : '📷 Photo (recommended)', 'ws-q'));
      if (it.photos.length) body.append(thumbs(it.photos.map(p => p.path)));
      if (can) {
        body.append(node('p', M.PHOTO_WARNING, 'ws-warn'));
        body.append(photoButton(it.photos.length ? 'Add another photo' : 'Take the photo', async f => {
          const out = await run('Uploading the photo…', () => client.addPhoto(chk.id, it.id, f));
          if (out) { current = out; show(itemScreen); tell('Photo saved.', 'ok'); if (it.result === 'done') setTimeout(() => valid() && screen === itemScreen && advance(), 700); }
        }));
      }
    }
    if (can) {
      body.append(field('Note', noteBox));
      const more = node('details', '', 'ws-help'); more.append(node('summary', 'Doesn\'t apply, or can\'t do it?'));
      const why = textBox('Why? (needed)');
      more.append(why, button('Doesn\'t apply here', () => save('na', {reason: why.value}), 'ws-big'), button('I can\'t do it', () => save('cannot_complete', {reason: why.value}), 'ws-big ws-stop'));
      if (it.result !== 'pending') more.append(button('Undo — mark it not done', () => save('pending'), 'ws-small'));
      body.append(more);
    }
    if (chk.me.isOwner && it.result === 'cannot_complete') {
      const w = textBox('Owner: why is it OK to waive this?'); body.append(w);
      body.append(button('Waive this step (owner)', async () => { const out = await run('Saving…', () => client.waiveItem(it.id, w.value)); if (out) { current = out; show(itemScreen); } }, 'ws-big ws-stop'));
    }
    body.append(button('Back to the list', () => { history.length = 0; show(overviewScreen); }, 'ws-small'));
    async function save(result, {value = null, reason = null} = {}) {
      const out = await run('Saving…', () => client.setItem(it.id, result, {value, reason, note: noteBox.value || null}));
      if (!out) return;
      current = out;
      const fresh = M.allItems(current).find(i => i.id === it.id);
      if (result === 'done' && fresh && M.photoNeeded(current, fresh)) { show(itemScreen); tell('Saved. Now take the photo.', 'ok'); return; }
      tell('Saved.', 'ok'); advance();
    }
  }
  function advance() {
    const next = M.nextStep(current);
    history.length = 0; screen = overviewScreen;
    if (next.kind === 'item' && next.item.id !== itemId) { itemId = next.item.id; history.push(overviewScreen); show(itemScreen); }
    else if (next.kind === 'walk') { history.push(overviewScreen); show(walkScreen); tell('All steps done. Now the walk test.', 'ok'); }
    else if (next.kind === 'submit') { history.push(overviewScreen); show(submitScreen); }
    else show(overviewScreen);
  }

  // ================================================================ walk test
  function walkScreen() {
    const chk = current, cams = chk.selection.cameras.filter(c => c.walk), tm = chk.testMode;
    title('Walk test', chk.unitLabel);
    note('This proves each camera really sends an event to Watchful. Settings alone are not proof.');
    const s1 = card(tm.on ? 'ws-good-card' : ''); s1.append(node('h2', '1. Put the site in Test mode in Watchful'));
    if (tm.on) s1.append(node('p', '✓ Test mode on — ' + tm.onBy + ', ' + M.formatCT(tm.onAt)));
    else if (chk.canEdit) {
      s1.append(node('p', 'So test events don\'t page the monitoring center. Then screenshot Watchful showing Test mode is on.'));
      s1.append(photoButton('Screenshot: Test mode is ON', async f => { const out = await run('Saving…', () => client.testMode(chk.id, true, f)); if (out) { current = out; show(walkScreen); tell('Test mode recorded. Now walk each camera.', 'ok'); } }));
    }
    const s2 = card(); s2.append(node('h2', '2. Walk in front of each camera'));
    for (const c of cams) {
      const row = node('div', '', 'ws-cam ' + (c.walk.passed ? 'ws-cam-pass' : c.walk.waived ? 'ws-cam-pass' : c.walk.failed ? 'ws-cam-fail' : ''));
      row.append(node('strong', c.name), node('span', c.walk.passed ? '✓ Watchful got it' : c.walk.waived ? '✓ Waived by the owner: ' + (c.walk.waivedReason || '') : c.walk.failed ? c.walk.failed + ' tries, no event yet' : 'Not tested yet', 'ws-sub'));
      if (!c.walk.passed && !c.walk.waived && chk.canEdit) row.append(button(tm.on ? 'Test ' + c.name : 'Turn on Test mode first', () => { camId = c.id; go(cameraWalkScreen); }, 'ws-big' + (tm.on ? ' ws-go' : '')));
      if (!c.walk.passed && !c.walk.waived && chk.me.isOwner) row.append(button('Owner: waive this camera', () => { camId = c.id; go(waiveWalkScreen); }, 'ws-small'));
      s2.append(row);
    }
    const allPassed = cams.every(c => c.walk.passed || c.walk.waived);
    const s3 = card(allPassed && tm.everOn && !tm.on ? 'ws-good-card' : ''); s3.append(node('h2', '3. Take Watchful out of Test mode'));
    if (tm.everOn && !tm.on) s3.append(node('p', '✓ Test mode off' + (tm.offAt ? ', ' + M.formatCT(tm.offAt) : '')));
    else if (tm.on && allPassed && chk.canEdit) s3.append(photoButton('Screenshot: Test mode is OFF', async f => { const out = await run('Saving…', () => client.testMode(chk.id, false, f)); if (out) { current = out; history.length = 0; screen = overviewScreen; history.push(overviewScreen); show(submitScreen); } }));
    else s3.append(node('p', tm.on ? 'Do this after every camera has passed.' : 'After the cameras pass.', 'ws-sub'));
  }
  let camId = null;
  function cameraWalkScreen() {
    const c = current.selection.cameras.find(x => x.id === camId);
    title('Walk test: ' + c.name, current.unitLabel);
    const how = card(); how.append(node('p', '1. Walk into this camera\'s view — inside its intrusion area.'), node('p', '2. In Watchful, watch for an event on ' + c.name + '. Give it up to 5 minutes.'));
    if (c.walk.checkSettings) {
      const w = card('ws-alert'); w.append(node('h2', '3 tries with no event'), node('p', 'Check this camera\'s settings against the checklist before trying again.'));
      w.append(button('Show this camera\'s steps', () => { const it = M.allItems(current).find(i => i.cameraId === c.id && /^[NC][1-4]$/.test(i.code)) || M.allItems(current).find(i => i.cameraId === c.id); if (it) { itemId = it.id; go(itemScreen); } }, 'ws-big'));
    }
    body.append(button('✓ Watchful got the event', () => go(eventTimeScreen), 'ws-big ws-go'));
    body.append(button('✗ Nothing after 5 minutes', async () => {
      const out = await run('Saving the try…', () => client.walk(current.id, c.id, false, null, null));
      if (out) { current = out; show(cameraWalkScreen); tell('Saved. Try again — every try is kept.', 'ok'); }
    }, 'ws-big ws-stop'));
    if (c.walk.attempts.length) {
      const d = node('details', '', 'ws-help'); d.append(node('summary', 'Tries so far (' + c.walk.attempts.length + ')'));
      for (const a of c.walk.attempts) d.append(node('p', '#' + a.no + ' ' + (a.received ? '✓ event at ' + M.formatCT(a.eventTime) : '✗ no event') + ' — ' + a.by + ', ' + M.formatCT(a.at)));
      body.append(d);
    }
  }
  function eventTimeScreen() {
    const c = current.selection.cameras.find(x => x.id === camId), now = M.ctNowInputs();
    title('When does Watchful show the event?', c.name);
    note('Copy the time from the Watchful event for ' + c.name + ' (Central time).');
    const date = node('input'); date.type = 'date'; date.value = now.date; date.className = 'ws-input'; date.setAttribute('aria-label', 'Event date');
    const time = node('input'); time.type = 'time'; time.value = now.time; time.className = 'ws-input'; time.setAttribute('aria-label', 'Event time');
    body.append(field('Date', date), field('Time', time));
    body.append(node('p', 'Then screenshot the Watchful event so it shows the camera name and the time.', 'ws-q'), node('p', M.PHOTO_WARNING, 'ws-warn'));
    body.append(photoButton('Screenshot the event and save', async f => {
      let iso; try { iso = M.ctToIso(date.value, time.value); } catch (e) { tell(e.message, 'error'); return; }
      const out = await run('Saving…', () => client.walk(current.id, c.id, true, iso, f));
      if (!out) return;
      current = out; history.pop(); history.pop(); show(walkScreen); tell('✓ ' + c.name + ' passed.', 'ok');
    }, 'ws-big ws-photo ws-go'));
  }
  function waiveWalkScreen() {
    const c = current.selection.cameras.find(x => x.id === camId);
    title('Waive the walk test for ' + c.name + '?');
    note('Only for a camera that cannot be tested now, like one physically missing and on order. The camera stays flagged "walk test waived" until it passes.');
    const why = textBox('Why? (needed)'); body.append(why);
    body.append(button('Waive it', async () => { const out = await run('Saving…', () => client.waiveWalk(c.id, why.value)); if (out) { current = out; goBack(); } }, 'ws-big ws-stop'));
  }

  // ================================================================ send to the office
  function submitScreen() {
    const chk = current;
    title('Send it to the office', chk.unitLabel);
    if (chk.blockers.length) {
      const c = card('ws-alert'); c.append(node('h2', chk.blockers.length + ' thing' + (chk.blockers.length === 1 ? '' : 's') + ' left'));
      for (const b of chk.blockers) c.append(node('p', '• ' + b));
      body.append(button('▶ Do the next one', () => { history.length = 0; screen = overviewScreen; doNext(); }, 'ws-big ws-go'));
      return;
    }
    card('ws-good-card').append(node('p', '✓ Every step is done and every camera passed the walk test.'));
    note('The office (IT or the owner) checks that Watchful shows every camera sending events, then signs it off. After you send it, it is locked for you.');
    body.append(button('Send to the office', async () => {
      const out = await run('Sending…', () => client.submit(chk.id));
      if (out) { current = out; home('Sent to the office. Thanks!'); }
    }, 'ws-big ws-go'));
  }

  // ================================================================ office check
  function officeScreen() {
    const chk = current, count = chk.selection.cameras.filter(c => !c.isSpeaker).length;
    title('Office check: ' + chk.unitLabel, chk.unitType + (chk.site ? ' · ' + chk.site : ''));
    const s = card(); s.append(node('p', 'Sent by ' + (chk.techSignedBy || 'the tech') + '.'), node('p', 'Walk tests:'));
    for (const c of chk.selection.cameras.filter(c => c.walk)) {
      const last = c.walk.attempts.filter(a => a.received).pop();
      const row = node('div', '', 'ws-cam ws-cam-pass'); row.append(node('strong', c.name), node('span', c.walk.waived ? 'Waived: ' + (c.walk.waivedReason || '') : '✓ event at ' + M.formatCT(last?.eventTime), 'ws-sub'));
      if (last?.photo) row.append(thumbs([last.photo])); s.append(row);
    }
    const notOnFile = chk.selection.cameras.filter(c => !c.modelId);
    if (notOnFile.length || chk.selection.recorderNotOnFile) {
      const w = card('ws-alert'); w.append(node('h2', 'Model not on file'), node('p', 'The owner has to match these to a model before sign-off.'));
      if (chk.selection.recorderNotOnFile) w.append(node('p', 'Recorder: ' + chk.selection.recorderNotOnFile));
      for (const c of notOnFile) { w.append(node('p', c.name + ': ' + c.notOnFile)); if (c.labelPhoto) w.append(thumbs([c.labelPhoto])); }
      if (chk.me.isOwner) w.append(button('Match the models (owner)', () => go(mapModelsScreen), 'ws-big'));
    }
    body.append(button('Look through every step and photo', () => go(overviewScreen), 'ws-big'));
    const q = card('ws-standard');
    q.append(node('h2', 'Watchful\'s camera count'), node('p', 'In Watchful, open the site overview card. What does "Cameras sending events" say for this unit? If the site has other units, use this unit\'s numbers from Components → Feeds.'));
    q.append(node('p', 'COS has ' + count + ' camera' + (count === 1 ? '' : 's') + ' on this unit (speakers not counted). Both numbers must be ' + count + '.', 'ws-q'));
    const x = node('input'); x.type = 'number'; x.inputMode = 'numeric'; x.min = '0'; x.className = 'ws-input ws-num'; x.setAttribute('aria-label', 'Cameras sending events');
    const y = node('input'); y.type = 'number'; y.inputMode = 'numeric'; y.min = '0'; y.className = 'ws-input ws-num'; y.setAttribute('aria-label', 'Cameras in Watchful');
    const pair = node('div', '', 'ws-pair'); pair.append(x, node('span', 'of', 'ws-of'), y); q.append(pair);
    let shot = null;
    const shotState = node('p', '', 'ws-sub'); q.append(shotState);
    q.append(photoButton('Screenshot of that card', f => { shot = f; shotState.textContent = '✓ Screenshot ready'; }));
    let override = null;
    if (chk.iAmTechSigner) {
      if (chk.me.isOwner) { override = textBox('You did the tech steps too. Owner: why is it OK to sign off yourself? (needed)'); q.append(override); }
      else q.append(node('p', 'You did the tech steps, so someone else has to do the office check.', 'ws-bad'));
    }
    q.append(button('Sign off — the unit is live', async () => {
      const xi = parseInt(x.value, 10), yi = parseInt(y.value, 10);
      if (!Number.isFinite(xi) || !Number.isFinite(yi)) return tell('Enter both numbers from Watchful.', 'error');
      if (xi !== yi || yi !== count) return tell('The numbers don\'t match (' + xi + ' of ' + yi + ', COS has ' + count + '). Send it back to the tech and say what is wrong: a camera missing in Watchful, an extra feed, or a camera not sending.', 'error');
      if (!shot) return tell('Take the screenshot of the card first.', 'error');
      const out = await run('Signing off…', () => client.signOff(chk.id, xi, yi, shot, override?.value));
      if (out) { current = out; home('✓ ' + chk.unitLabel + ' is signed off and live.'); }
    }, 'ws-big ws-go'));
    body.append(button('Send it back to the tech', () => go(sendBackScreen), 'ws-big ws-stop'));
  }
  function sendBackScreen() {
    const chk = current;
    title('Send it back', chk.unitLabel);
    note('Pick the steps the tech has to redo. Only those open up again; then they walk-test again.');
    const picked = new Set();
    for (const s of chk.sections) {
      const d = node('details', '', 'ws-section'); d.append(node('summary', s.title));
      for (const it of s.items.filter(i => i.standardStatus !== 'PLACEHOLDER')) {
        const l = node('label', '', 'ws-checkrow'); const cb = node('input'); cb.type = 'checkbox';
        cb.addEventListener('change', () => cb.checked ? picked.add(it.id) : picked.delete(it.id));
        l.append(cb, node('span', it.title + (it.value ? ': ' + it.value : ''))); d.append(l);
      }
      body.append(d);
    }
    const why = textBox('What is wrong? The tech sees this. (needed)', '', 3); body.append(why);
    body.append(button('Send it back', async () => {
      const out = await run('Sending back…', () => client.sendBack(chk.id, why.value, [...picked]));
      if (out) { current = out; home('Sent back to ' + first(chk.techSignedBy) + '.'); }
    }, 'ws-big ws-stop'));
  }
  let mapOptions = null;
  async function mapModelsScreen() {
    const chk = current;
    title('Match the models', chk.unitLabel);
    if (!mapOptions) { mapOptions = await run('Loading…', () => client.options(chk.unitType)); if (!mapOptions) return; return show(mapModelsScreen); }
    const why = textBox('Note for the record, like: label read as ALI-PB50-LUAIS-D'); body.append(why);
    const list = (target, role) => Object.values(mapOptions.choices).flat().filter(m => m.role === role);
    if (chk.selection.recorderNotOnFile) {
      body.append(node('h2', 'Recorder: "' + chk.selection.recorderNotOnFile + '" is…', 'ws-h2'));
      for (const m of list(null, 'nvr')) body.append(button(m.model, async () => { const out = await run('Saving…', () => client.mapModel(chk.id, null, m.id, why.value)); if (out) { current = out; show(mapModelsScreen); } }, 'ws-big ws-pick'));
    }
    for (const c of chk.selection.cameras.filter(c => !c.modelId)) {
      body.append(node('h2', c.name + ': "' + c.notOnFile + '" is…', 'ws-h2'));
      for (const m of list(c, c.role)) body.append(button(m.model, async () => { const out = await run('Saving…', () => client.mapModel(chk.id, c.id, m.id, why.value)); if (out) { current = out; show(mapModelsScreen); } }, 'ws-big ws-pick'));
    }
    if (!chk.selection.recorderNotOnFile && !chk.selection.cameras.some(c => !c.modelId)) { card('ws-good-card').append(node('p', '✓ All models matched.')); body.append(button('Back to the office check', () => goBack(), 'ws-big ws-go')); }
    else note('A model not in these lists has to be added to the catalog first (ask Claude / the admin).');
  }

  // ================================================================ quiet cameras (IT and owner)
  let quietData = null, quietTabNow = 'quiet';
  function quietScreen() {
    title('Quiet cameras');
    note('From the last-event times in Watchful. A camera with no event in ' + (quietData?.quietDays || 7) + ' days is Quiet. No reading means Unknown — it does not mean the camera is down.');
    const box = node('div'); body.append(box);
    const paint = () => {
      box.replaceChildren();
      const d = quietData; if (!d) return;
      if (d.lastImport) box.append(node('p', 'Last import: ' + M.formatCT(d.lastImport.at) + ' by ' + (d.lastImport.by || '?') + ' — ' + d.lastImport.matched + ' of ' + d.lastImport.rows + ' cameras matched.', 'ws-sub'));
      else box.append(node('p', 'No Watchful list imported yet.', 'ws-bad'));
      box.append(button('⬆ Import the Watchful last-event list', () => go(importScreen), 'ws-big ws-go'));
      if (d.unmatched.length) box.append(button('🔗 ' + d.unmatched.length + ' Watchful name' + (d.unmatched.length === 1 ? '' : 's') + ' to match', () => go(unmatchedScreen), 'ws-big ws-warnbtn'));
      const tabs = node('div', '', 'ws-tabs');
      for (const [k, label] of M.QUIET_TABS) {
        const n = M.quietTab(d.cameras, k).length;
        const t = button(label + ' ' + n, () => { quietTabNow = k; paint(); }, 'ws-tab' + (quietTabNow === k ? ' ws-on' : ''));
        t.setAttribute('aria-pressed', String(quietTabNow === k)); tabs.append(t);
      }
      box.append(tabs);
      const rows = M.quietTab(d.cameras, quietTabNow);
      if (!rows.length) box.append(node('p', 'None.', 'ws-note'));
      for (const c of rows.slice(0, 200)) {
        const k = node('section', '', 'ws-card ' + (c.status === 'quiet' || c.status === 'never_sent' ? 'ws-alert' : ''));
        k.append(node('h2', c.camera), node('p', c.unit + (c.site ? ' · ' + c.site : '') + (c.model ? ' · ' + c.model : ''), 'ws-sub'));
        k.append(node('p', c.lastEvent ? 'Last event ' + M.formatCT(c.lastEvent) + (c.daysQuiet != null ? ' — ' + c.daysQuiet + ' days before the reading' : '') : (c.note || 'No event recorded')));
        if (c.note && c.lastEvent) k.append(node('p', c.note, 'ws-sub'));
        if (c.flags) k.append(node('p', '⚑ ' + c.flags, 'ws-amber-text'));
        if (c.legacy) k.append(node('p', 'Legacy: not checklisted', 'ws-sub'));
        if (c.alert?.ackNote) k.append(node('p', '👤 ' + c.alert.ackBy + ': ' + c.alert.ackNote, 'ws-good'));
        if (c.alert) k.append(button(c.alert.ackNote ? 'Update who is on it' : 'I\'m on it / who is on it', () => { ackFor = c; go(ackScreen); }, 'ws-small'));
        k.append(button(c.placement === 'field' ? 'Unit is in the shop / testing' : 'Unit is back in the field', () => { placeTarget = c; go(placementScreen); }, 'ws-small ws-quietbtn'));
        box.append(k);
      }
    };
    paint();
    run('Loading…', async () => { quietData = await client.quiet(); }).then(ok => { if (ok && screen === quietScreen) paint(); });
  }
  let ackFor = null, placeTarget = null;
  function ackScreen() {
    title('Who is on ' + ackFor.camera + '?');
    note('This does not hide the camera. It shows the team someone is on it. It closes by itself when Watchful shows a new event.');
    const t = textBox('For example: Josh heading out Monday', ackFor.alert?.ackNote || ''); body.append(t);
    body.append(button('Save', async () => { if (await run('Saving…', () => client.ack(ackFor.alert.id, t.value))) { quietData = null; goBack(); } }, 'ws-big ws-go'));
  }
  function placementScreen() {
    const c = placeTarget;
    title('Where is ' + c.unit + '?');
    note('Units in the shop, testing or burn-in are never counted as quiet or as an outage. This changes nothing in mHelp, VCC or Watchful.');
    const why = textBox('Note (optional)'); body.append(why);
    for (const [v, t] of [['field', 'In the field (watch it)'], ['shop', 'In the shop'], ['test', 'Testing'], ['burn_in', 'Burn-in']])
      body.append(button(t + (c.placement === v ? '  ✓ now' : ''), async () => { if (await run('Saving…', () => client.placement(c.unitKey, v, why.value || null))) { quietData = null; goBack(); } }, 'ws-big ws-pick' + (c.placement === v ? ' ws-on' : '')));
  }
  function importScreen() {
    title('Import the Watchful list');
    note('A CSV with columns: site, unit, camera, last event (time), read time. Times without a zone are read as Central time. Rows are never dropped: names that don\'t match go to the matching list.');
    const now = M.ctNowInputs();
    const date = node('input'); date.type = 'date'; date.value = now.date; date.className = 'ws-input';
    const time = node('input'); time.type = 'time'; time.value = now.time; time.className = 'ws-input';
    body.append(field('When was the Watchful list read? Date', date), field('Time', time));
    const file = node('input'); file.type = 'file'; file.accept = '.csv,text/csv'; file.className = 'ws-input'; file.setAttribute('aria-label', 'CSV file');
    body.append(field('The CSV file', file));
    const out = node('div'); body.append(out);
    body.append(button('Import', async () => {
      const f = file.files?.[0]; if (!f) return tell('Pick the CSV file first.', 'error');
      let parsed, readAt;
      try { readAt = M.ctToIso(date.value, time.value); parsed = M.importRows(await f.text()); } catch (e) { return tell(e.message, 'error'); }
      if (parsed.problems.length) { out.replaceChildren(node('p', 'Fix these rows in the file, then import again:', 'ws-bad'), ...parsed.problems.slice(0, 20).map(p => node('p', p, 'ws-sub'))); return tell(parsed.problems.length + ' row(s) could not be read.', 'error'); }
      const r = await run('Importing ' + parsed.rows.length + ' rows…', () => client.importRows(readAt, parsed.rows));
      if (r) { quietData = null; flash = 'Imported ' + r.rows + ' rows: ' + r.matched + ' matched, ' + r.unmatched + ' to match by hand.'; goBack(); }
    }, 'ws-big ws-go'));
  }
  function unmatchedScreen() {
    title('Match Watchful names');
    note('Watchful names often add things like " - Cam 001". Match each one once; later imports use the match.');
    for (const [i, u] of (quietData?.unmatched || []).entries()) {
      const k = card(); k.append(node('h2', u.camera), node('p', u.unit + (u.site ? ' · ' + u.site : '') + (u.lastEvent ? ' · last event ' + M.formatCT(u.lastEvent) : ''), 'ws-sub'));
      k.append(button('Match it', () => { matchRow = i; go(matchScreen); }, 'ws-big'));
    }
  }
  let matchRow = 0;
  function matchScreen() {
    const u = quietData.unmatched[matchRow];
    title('Which camera is "' + u.camera + '"?', u.unit);
    const words = u.unit.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const near = quietData.cameras.filter(c => words.some(w => (c.unit + ' ' + c.unitKey).toLowerCase().includes(w)));
    for (const c of (near.length ? near : quietData.cameras).slice(0, 40))
      body.append(button(c.camera + ' — ' + c.unit, async () => { if (await run('Matching…', () => client.mapName(u, c.id, null))) { quietData = null; history.pop(); goBack(); } }, 'ws-big ws-pick'));
    const d = node('details', '', 'ws-help'); d.append(node('summary', 'It is on a unit that has not been checked yet'));
    const key = node('input'); key.className = 'ws-input'; key.placeholder = 'COS unit, like SPOTTER 236'; key.value = u.unit; key.setAttribute('aria-label', 'COS unit');
    d.append(node('p', 'The camera is watched now and shows "Legacy: not checklisted" until the unit gets a Watchful setup check.'), key,
      button('Watch it as a camera on that unit', async () => { if (await run('Saving…', () => client.mapName(u, null, key.value))) { quietData = null; history.pop(); goBack(); } }, 'ws-big'));
    body.append(d);
  }

  // ---------------------------------------------------------------- go
  if (start) openCheck(start); else home();
  return close;
}

// ================================================================ the big button on each home screen
// The button shows only once the server answers, so this file can be published before the
// database change is applied: until then nobody sees a button that would only show an error.
let mounted = null, owner = '', closePanel = null, scheduled = false, counting = false, lastCount = 0, ready = false, lastProbe = 0;
function placeFor(role) {
  if (role === 'service') return {el: document.querySelector('#wlSvcHome .wl-service-action-list'), how: 'prepend'};
  if (role === 'it') {
    const ws = document.querySelector('#wlItHome .wl-it-command-workspace');
    return ws ? {el: ws, how: 'before'} : {el: document.getElementById('wlItHome'), how: 'prepend'};
  }
  const view = document.getElementById('view-owner'), page = document.getElementById('ownerRouteView');
  if (role === 'owner' && view && !view.classList.contains('hidden') && ['today', 'units', 'review'].includes(view.dataset.ownerRoute) && page) {
    const header = page.querySelector('.ownerAppPageHeader'); return header ? {el: header, how: 'after'} : {el: page, how: 'prepend'};
  }
  return {el: null};
}
const scope = () => {
  const c = window.TechCheckContext, p = c?.getProfile?.(), id = c?.getSession()?.user?.id, role = c?.getRole?.();
  if (!id || p?.user_id !== id || p.active !== true || p.archived_at || !['service', 'it', 'owner'].includes(role) || document.getElementById('appView')?.classList.contains('hidden')) return null;
  return {c, id, role};
};
function sync() {
  const s = scope(), identity = s ? s.id + ':' + s.role : '';
  if (owner !== identity) { closePanel?.(); closePanel = null; mounted?.remove(); mounted = null; owner = identity; lastCount = 0; ready = false; lastProbe = 0; }
  if (!s) return;
  if (!ready) { void count(); return; }
  const at = placeFor(s.role);
  if (!at.el) { mounted?.remove(); mounted = null; return; }
  const inPlace = mounted?.isConnected && (at.how === 'prepend' ? mounted.parentElement === at.el : at.how === 'before' ? mounted.nextElementSibling === at.el : mounted.previousElementSibling === at.el);
  if (!inPlace) {
    mounted?.remove();
    mounted = document.createElement('button'); mounted.type = 'button'; mounted.className = 'ws-launch'; mounted.dataset.cosWatchfulSetup = '';
    mounted.textContent = '📡 Watchful setup check';
    mounted.addEventListener('click', e => { e.stopPropagation(); closePanel?.(); closePanel = openWatchful(s.c, {onChange: () => { lastCount = 0; }}); });
    if (at.how === 'prepend') at.el.prepend(mounted); else if (at.how === 'before') at.el.before(mounted); else at.el.after(mounted);
  }
  void count();
}
async function count() {
  const s = scope();
  if (!s || counting || document.hidden) return;
  if (!ready && Date.now() - lastProbe < 600000 && lastProbe) return;
  if (ready && (!mounted?.isConnected || Date.now() - lastCount < 60000)) return;
  counting = true; lastCount = lastProbe = Date.now();
  try {
    const d = await wsClient(s.c).home();
    if (!ready) { ready = true; counting = false; lastCount = 0; sync(); return; }
    const b = mounted; if (!b) return;
    const back = d.open.filter(c => c.status === 'returned').length, waiting = d.me.canOffice ? d.waiting.length : 0, open = d.open.length;
    const quiet = d.quiet ? d.quiet.quiet + d.quiet.neverSent : 0;
    const bits = [back && back + ' sent back', waiting && waiting + ' to sign off', !back && open && open + ' open', quiet && quiet + ' quiet'].filter(Boolean);
    b.textContent = '📡 Watchful setup check' + (bits.length ? ' — ' + bits.join(' · ') : '');
    b.classList.toggle('ws-launch-alert', Boolean(back || waiting));
  } catch { /* not available yet (or no signal): no button until the server answers */ }
  finally { counting = false; }
}
if (typeof document !== 'undefined') {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./style.css?v=ws-v1', import.meta.url).href; document.head.append(css);
  const schedule = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; sync(); }); };
  new MutationObserver(schedule).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-owner-route']});
  for (const e of ['techcheck:view-changed', 'techcheck:data-refreshed', 'pageshow', 'online']) window.addEventListener(e, () => { lastCount = 0; schedule(); });
  document.addEventListener('visibilitychange', () => { lastCount = 0; schedule(); });
  setInterval(() => void count(), 60000); schedule();
}
