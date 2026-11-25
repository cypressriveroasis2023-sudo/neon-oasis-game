// "My truck" for Service techs, on the phone: what is on my truck against the standard,
// units coming to me, units IT gave me, and giving a unit to another tech.
// One question per screen, big buttons. The server checks everything again.
import {truckClient, myUnits} from './client.js?v=truck-extras-v1';
import {transferJpeg} from '../transfers/client.js';
import {createDailySignoff, newSignature, signatureJpeg, hasSignatureInk} from '../service-signoff-ui.js';

const node = (tag, text = '', cls = '') => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, run, cls = 'tm-big') => { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', run); return b; };
const unitName = u => u.type + ' ' + u.tag;
const first = name => (name || '').split(' ')[0] || name;
const uuid = () => crypto.randomUUID();
const CHECKS = [
  ['number_matches', u => 'Does the unit say ' + unitName(u) + '?', 'Yes, it matches', 'No, different number'],
  ['no_damage', () => 'Is it free of damage?', 'No damage', 'Damaged'],
  ['all_parts', () => 'Is everything with it? (cables, mount, antenna)', 'All there', 'Something missing'],
];

export function openMyTruck(context, {onChange = () => {}} = {}) {
  const client = truckClient(context);
  const dialog = node('dialog', '', 'tm-dialog'), bar = node('div', '', 'tm-bar'), status = node('p', '', 'tm-status'), body = node('div', '', 'tm-body');
  const closeButton = button('✕', () => close(), 'tm-icon'); closeButton.setAttribute('aria-label', 'Close');
  const refresh = button('↻', () => void load(), 'tm-icon'); refresh.setAttribute('aria-label', 'Refresh');
  bar.append(node('div', 'CAMERAS ONSITE', 'tm-brand'), refresh, closeButton);
  dialog.append(bar, status, body); document.body.append(dialog);
  let alive = true, busy = false, data = null, flow = null;
  const valid = () => alive && client.current() && dialog.isConnected;
  const tell = (text, error = false) => { if (!valid()) return; status.textContent = text; status.setAttribute('role', error ? 'alert' : 'status'); status.classList.toggle('tm-error', error); if (error) dialog.scrollTop = 0; };
  function close() { if (busy) return; alive = false; dialog.close(); dialog.remove(); }
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (flow) { flow = null; render(); } else close(); });
  dialog.showModal();

  async function run(label, work) {
    if (busy) return; busy = true; tell(label);
    for (const b of dialog.querySelectorAll('button')) b.disabled = true;
    try { const next = await work(); if (!valid()) return; if (next) data = next; onChange(); return true; }
    catch (e) { tell(e.message, true); return false; }
    finally { busy = false; if (valid()) for (const b of dialog.querySelectorAll('button')) b.disabled = false; }
  }
  async function load(message = '') {
    if (!(await run('Loading your truck…', () => client.read()))) return;
    flow = null; render(); tell(message);
  }

  // ------------------------------------------------------------- home
  function render() {
    body.replaceChildren();
    if (!data) return;
    if (flow) return flow.render();
    body.append(node('h1', 'My truck', 'tm-title'));
    for (const m of data.coming) {
      const card = node('section', '', 'tm-card tm-alert');
      card.append(node('h2', first(m.from) + ' is giving you ' + unitName(m)), node('p', 'It goes on your truck when you check it and sign.'));
      card.append(button('Check it and sign', () => startTake(m), 'tm-big tm-go'));
      body.append(card);
    }
    for (const u of data.fromIt) {
      const card = node('section', '', 'tm-card tm-alert');
      card.append(node('h2', 'IT gave you ' + unitName(u)), node('p', 'You signed for it. Put it on your truck in the app.'));
      card.append(button('Put ' + unitName(u) + ' on my truck', () => run('Saving…', () => client.putFromIt(u.type, u.tag)).then(ok => { if (ok) { render(); tell(unitName(u) + ' is on your truck.'); } }), 'tm-big tm-go'));
      body.append(card);
    }
    const grid = node('section', '', 'tm-grid');
    for (const k of data.kinds) {
      const short = k.have < k.required;
      const tile = node('div', '', 'tm-tile ' + (short ? 'tm-short' : 'tm-ok'));
      tile.setAttribute('aria-label', k.type + ': has ' + k.have + ' of ' + k.required);
      tile.append(node('div', k.type, 'tm-type'), node('div', String(k.have), 'tm-count'), node('div', 'of ' + k.required + ' needed', 'tm-need'));
      const tags = node('div', '', 'tm-tags');
      if (k.slot) tags.append(node('span', k.slot, 'tm-tag'));
      for (const x of k.extras) tags.append(node('span', x.tag + ' extra', 'tm-tag tm-extra'));
      if (!k.slot && !k.extras.length) tags.append(node('span', k.slotUsed ? 'Used in a swap — IT will restock' : 'None', 'tm-none'));
      tile.append(tags);
      if (short) tile.append(node('div', 'Short ' + (k.required - k.have), 'tm-flag'));
      grid.append(tile);
    }
    body.append(grid);
    const units = myUnits(data);
    const give = button('Give a unit to another tech', () => startGive(), 'tm-big tm-go');
    if (!units.length || !data.techs.length) { give.disabled = true; give.title = units.length ? 'No other Service tech is set up.' : 'No units on your truck.'; }
    body.append(give);
    if (data.sent.length) {
      const sec = node('section', '', 'tm-card');
      sec.append(node('h2', 'Sent, waiting'));
      for (const m of data.sent) {
        const row = node('div', '', 'tm-row');
        row.append(node('p', unitName(m) + ' → ' + m.to + '. Still on your truck until ' + first(m.to) + ' signs.'));
        row.append(button('Cancel ' + unitName(m), () => run('Cancelling…', () => client.cancel(m.id)).then(ok => { if (ok) { render(); tell('Cancelled. ' + unitName(m) + ' stays on your truck.'); } }), 'tm-small'));
        sec.append(row);
      }
      body.append(sec);
    }
    if (data.recent.length) {
      const sec = node('section', '', 'tm-card tm-quiet');
      sec.append(node('h2', 'Last 3 days'));
      for (const m of data.recent) {
        const mine = m.fromId === client.actor;
        const what = m.state === 'accepted' ? (mine ? 'You gave ' + unitName(m) + ' to ' + m.to : m.from + ' gave you ' + unitName(m))
          : m.state === 'refused' ? (mine ? m.to + ' did not take ' + unitName(m) + (m.takeNote ? ': ' + m.takeNote : '') : 'You did not take ' + unitName(m))
          : (mine ? 'You cancelled ' + unitName(m) : m.from + ' cancelled ' + unitName(m));
        sec.append(node('p', what));
      }
      body.append(sec);
    }
  }

  // ------------------------------------------------------------- step frame
  function step(n, total, title, back) {
    body.replaceChildren();
    const head = node('div', '', 'tm-step');
    head.append(node('span', 'Step ' + n + ' of ' + total), button('‹ Back', back, 'tm-small tm-back'));
    body.append(head, node('h1', title, 'tm-title'));
  }
  function photoStep(state, label, onNext) {
    const input = node('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.className = 'tm-file';
    input.setAttribute('aria-label', label);
    const take = node('label', '', 'tm-big tm-photo'); take.append(node('span', state.photos.length ? '📷 Take another photo' : '📷 Take photo'), input);
    input.addEventListener('change', async () => {
      if (busy) return; busy = true; tell('Saving the photo…');
      try { for (const f of input.files) { if (state.photos.length >= 8) throw new Error('Use no more than 8 photos.'); state.photos.push(await transferJpeg(f)); } tell(''); }
      catch (e) { tell(e.message, true); } finally { busy = false; if (valid()) render(); }
    });
    body.append(take);
    if (state.photos.length) {
      const row = node('div', '', 'tm-thumbs');
      for (const blob of state.photos) { const img = node('img'); img.alt = 'Photo'; img.src = URL.createObjectURL(blob); row.append(img); }
      body.append(row, node('p', state.photos.length + ' photo' + (state.photos.length > 1 ? 's' : '') + ' taken', 'tm-note'));
      body.append(button('Next', onNext, 'tm-big tm-go'));
    }
  }

  // ------------------------------------------------------------- give
  function startGive() {
    const g = {move: uuid(), unit: null, to: null, photos: [], note: '', at: 1};
    flow = {render() {
      if (g.at === 1) {
        step(1, 4, 'Which unit are you giving?', () => { flow = null; render(); });
        for (const u of myUnits(data)) body.append(button(unitName(u) + (u.extra ? ' (extra)' : ''), () => { g.unit = u; g.at = 2; render(); }, 'tm-big tm-pick'));
      } else if (g.at === 2) {
        step(2, 4, 'Who are you giving ' + unitName(g.unit) + ' to?', () => { g.at = 1; render(); });
        for (const t of data.techs) body.append(button(t.name, () => { g.to = t; g.at = 3; render(); }, 'tm-big tm-pick'));
      } else if (g.at === 3) {
        step(3, 4, 'Take a photo of ' + unitName(g.unit), () => { g.at = 2; render(); });
        body.append(node('p', 'Show the unit number in the photo.', 'tm-note'));
        photoStep(g, 'Photo of the unit you are giving', () => { g.at = 4; render(); });
      } else {
        step(4, 4, 'Send it', () => { g.at = 3; render(); });
        const sum = node('div', '', 'tm-summary');
        sum.append(node('div', unitName(g.unit), 'tm-count'), node('p', 'to ' + g.to.name));
        body.append(sum);
        const note = node('textarea'); note.rows = 2; note.maxLength = 500; note.value = g.note; note.placeholder = 'Note (optional), like where the unit is';
        note.setAttribute('aria-label', 'Note for ' + g.to.name); note.addEventListener('input', () => { g.note = note.value; });
        body.append(note, node('p', 'It stays on your truck until ' + first(g.to.name) + ' checks it and signs.', 'tm-note'));
        body.append(button('Send to ' + first(g.to.name), () => run('Sending…', () => client.give({move: g.move, to: g.to.id, type: g.unit.type, tag: g.unit.tag, photos: g.photos, note: g.note}))
          .then(ok => { if (ok) { flow = null; render(); tell('Sent. ' + first(g.to.name) + ' has to check ' + unitName(g.unit) + ' and sign.'); } }), 'tm-big tm-go'));
      }
    }};
    render(); tell('');
  }

  // ------------------------------------------------------------- take
  function startTake(m) {
    const t = {checks: {}, photos: [], note: '', signature: newSignature(), at: 1, refusing: false};
    const problems = () => CHECKS.filter(([k]) => t.checks[k] === 'problem').length;
    const total = 5;
    flow = {render() {
      if (t.refusing) {
        step(1, 1, "Don't take " + unitName(m), () => { t.refusing = false; render(); });
        const why = node('textarea'); why.rows = 3; why.maxLength = 500; why.value = t.note; why.placeholder = 'Why? For example: the number says 017, not 007';
        why.setAttribute('aria-label', 'Why you are not taking it'); why.addEventListener('input', () => { t.note = why.value; });
        body.append(why, node('p', 'It stays on ' + first(m.from) + "'s truck. " + first(m.from) + ' gets your reason.', 'tm-note'));
        body.append(button("Send: I'm not taking it", () => run('Sending…', () => client.refuse(m.id, t.note)).then(ok => { if (ok) { flow = null; render(); tell('Sent. ' + unitName(m) + ' stays on ' + first(m.from) + "'s truck."); } }), 'tm-big tm-stop'));
        return;
      }
      const refuse = () => button("Don't take it", () => { t.refusing = true; render(); }, 'tm-big tm-stop');
      if (t.at === 1) {
        step(1, total, first(m.from) + ' is giving you ' + unitName(m), () => { flow = null; render(); });
        if (m.note) body.append(node('p', first(m.from) + ' wrote: ' + m.note, 'tm-card'));
        const pics = node('div', '', 'tm-thumbs'); body.append(pics);
        for (const p of m.photos.slice(0, 3)) client.photoUrl(p).then(url => { if (!valid()) return; const img = node('img'); img.alt = first(m.from) + "'s photo"; img.src = url; pics.append(img); }).catch(() => {});
        body.append(node('p', 'Find the unit and look at it before you go on.', 'tm-note'), button('I have it in front of me', () => { t.at = 2; render(); }, 'tm-big tm-go'), refuse());
      } else if (t.at === 2) {
        step(2, total, 'Check the unit', () => { t.at = 1; render(); });
        for (const [key, ask, yes, no] of CHECKS) {
          const q = node('fieldset', '', 'tm-check'); q.append(node('legend', ask(m)));
          const pick = v => () => { t.checks[key] = v; render(); };
          const a = button(yes, pick('pass'), 'tm-big tm-choice' + (t.checks[key] === 'pass' ? ' tm-on' : '')); a.setAttribute('aria-pressed', String(t.checks[key] === 'pass'));
          const b = button(no, pick('problem'), 'tm-big tm-choice tm-bad' + (t.checks[key] === 'problem' ? ' tm-on' : '')); b.setAttribute('aria-pressed', String(t.checks[key] === 'problem'));
          q.append(a, b); body.append(q);
        }
        if (t.checks.number_matches === 'problem') {
          body.append(node('p', "The number doesn't match, so don't take it.", 'tm-card tm-alert'), refuse());
        } else if (CHECKS.every(([k]) => t.checks[k])) {
          body.append(button('Next', () => { t.at = 3; render(); }, 'tm-big tm-go'));
        }
      } else if (t.at === 3) {
        step(3, total, 'Take a photo of ' + unitName(m), () => { t.at = 2; render(); });
        body.append(node('p', problems() ? 'Show the problem in the photo.' : 'Show the unit number in the photo.', 'tm-note'));
        photoStep(t, 'Photo of the unit you are taking', () => { t.at = 4; render(); });
      } else if (t.at === 4) {
        step(4, total, problems() ? 'Write what is wrong' : 'Anything to add?', () => { t.at = 3; render(); });
        const note = node('textarea'); note.rows = 3; note.maxLength = 500; note.value = t.note;
        note.placeholder = problems() ? 'Required: what is damaged or missing' : 'Optional'; note.setAttribute('aria-label', 'Note');
        const next = button('Next', () => { t.at = 5; render(); }, 'tm-big tm-go');
        const gate = () => { next.disabled = problems() > 0 && t.note.trim().length < 5; };
        note.addEventListener('input', () => { t.note = note.value; gate(); });
        body.append(note, next); gate();
      } else {
        step(5, total, 'Sign for ' + unitName(m), () => { t.at = 4; render(); });
        const sign = button('Sign and put it on my truck', () => submitTake(), 'tm-big tm-go');
        const ready = () => { sign.disabled = !(t.signature.confirmed && (t.signature.method === 'typed' ? t.signature.typedName.trim() : hasSignatureInk(t.signature))); };
        body.append(createDailySignoff({state: t.signature, actorName: data.me.name, isBusy: () => busy, onChange: ready,
          statementText: 'I have ' + unitName(m) + ' in my hands. I checked it, and I am taking it onto my truck from ' + m.from + '.',
          signatureGroup: 'tm-signature-' + m.id}), sign);
        ready();
      }
    }};
    async function submitTake() {
      const ok = await run('Saving your signature…', async () => {
        if (t.signature.method === 'drawn' && !t.signature.blob) t.signature.blob = await signatureJpeg(t.signature);
        return client.take({move: m.id, checks: t.checks, photos: t.photos, signature: t.signature, note: t.note});
      });
      if (ok) { flow = null; render(); tell(unitName(m) + ' is on your truck.'); }
    }
    render(); tell('');
  }

  void load();
  return () => { busy = false; close(); };
}

// ------------------------------------------------------------- the big button on the Service home
let mounted = null, owner = '', closePanel = null, scheduled = false, counting = false, lastCount = 0;
const scope = () => {
  const c = window.TechCheckContext, p = c?.getProfile?.(), id = c?.getSession()?.user?.id;
  if (!id || p?.user_id !== id || p.active !== true || p.archived_at || c.getRole?.() !== 'service' || document.getElementById('appView')?.classList.contains('hidden')) return null;
  return {c, id};
};
function sync() {
  const s = scope(), identity = s ? s.id : '';
  if (owner !== identity) { closePanel?.(); closePanel = null; mounted?.remove(); mounted = null; owner = identity; lastCount = 0; }
  if (!s) return;
  const target = document.querySelector('#wlSvcHome .wl-service-action-list');
  if (!target) return;
  if (!mounted?.isConnected || mounted.parentElement !== target) {
    mounted?.remove();
    mounted = button('🚚 My truck', () => { closePanel?.(); closePanel = openMyTruck(s.c, {onChange: () => { lastCount = 0; void count(); }}); }, 'tm-launch');
    mounted.dataset.cosMyTruck = '';
    target.prepend(mounted);
  }
  void count();
}
async function count() {
  const s = scope(), b = mounted;
  if (!s || !b?.isConnected || counting || Date.now() - lastCount < 60000 || document.hidden) return;
  counting = true; lastCount = Date.now();
  try {
    const d = await truckClient(s.c).read();
    const waiting = d.coming.length + d.fromIt.length, short = d.kinds.filter(k => k.have < k.required).length;
    b.textContent = '🚚 My truck' + (waiting ? ' — ' + waiting + ' to sign for' : short ? ' — short ' + short : '');
    b.classList.toggle('tm-launch-alert', waiting > 0);
  } catch { /* the button still opens; the screen shows the error */ }
  finally { counting = false; }
}
if (typeof document !== 'undefined') {
  const css = node('link'); css.rel = 'stylesheet'; css.href = new URL('./style.css?v=truck-extras-v1', import.meta.url).href; document.head.append(css);
  const schedule = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; sync(); }); };
  new MutationObserver(schedule).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
  for (const e of ['techcheck:view-changed', 'techcheck:data-refreshed', 'pageshow', 'online', 'techcheck:ticketfree-return-saved']) window.addEventListener(e, () => { lastCount = 0; schedule(); });
  document.addEventListener('visibilitychange', () => { lastCount = 0; schedule(); });
  setInterval(() => void count(), 60000); schedule();
}
