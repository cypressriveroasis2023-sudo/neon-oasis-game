const editDb = window.__techCheckDb;

const EDIT_TYPES = ['Sniper', 'Ranger', 'Helios', 'Solar Spotter', 'Spotter', 'Recon 2'];
const EDIT_PURPOSES = ['BACKUP', 'SWAP', 'DELIVERY'];
const FIXED_BATTERIES = { Sniper: 2, Ranger: 1, Helios: 1, 'Solar Spotter': 4, Spotter: 0 };
let correctionRenderTimer = null;
let correctionRendering = false;

function editEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}

function editRoleAllowed() {
  const role = document.getElementById('whoRole')?.textContent || '';
  return role.includes('IT Tech') || role.includes('Owner/Admin');
}

function equipmentOptions(selected) {
  return EDIT_TYPES.map(type => '<option value="' + editEsc(type) + '"' + (type === selected ? ' selected' : '') + '>' + editEsc(type === 'Recon 2' ? 'Recon II' : type) + '</option>').join('');
}

function purposeOptions(selected) {
  return EDIT_PURPOSES.map(p => '<option value="' + p + '"' + (p === selected ? ' selected' : '') + '>' + p + '</option>').join('');
}

function batteryRequired(type, stored) {
  if (type === 'Recon 2') return Math.max(1, Number(stored || 1));
  return Number(FIXED_BATTERIES[type] || 0);
}

function statusBadge(status) {
  if (status === 'draft') return '<span class="pill amber">IT EQUIPMENT PREP</span>';
  if (status === 'released') return '<span class="pill green">READY FOR SERVICE CHECKOUT</span>';
  return '<span class="pill">EQUIPMENT VERIFIED</span>';
}

function structuralRow(item, prepId, temporary = false) {
  const id = temporary ? '' : item.id;
  const type = item.equipment_type || 'Sniper';
  const purpose = item.purpose || 'BACKUP';
  const required = batteryRequired(type, item.required_battery_count);
  const verification = temporary ? '' : verificationEditor(item);
  return '<div class="item cos-struct-row" data-prep-id="' + prepId + '" data-item-id="' + editEsc(id) + '">' +
    '<div class="grid3">' +
      '<div><label>Equipment Type</label><select class="cos-eq">' + equipmentOptions(type) + '</select></div>' +
      '<div><label>Purpose</label><select class="cos-purpose">' + purposeOptions(purpose) + '</select></div>' +
      '<div class="cos-recon-wrap"' + (type === 'Recon 2' ? '' : ' style="display:none"') + '><label>Recon Battery Count</label><input class="cos-required" type="number" min="1" value="' + required + '"></div>' +
    '</div>' +
    '<div class="row top8"><span class="small">' + (temporary ? 'New equipment row — save changes to create it.' : 'Current unit: ' + editEsc(item.unit_tag || 'not assigned')) + '</span><button class="mini danger cos-remove-row" type="button">Remove Row</button></div>' +
    verification +
  '</div>';
}

function verificationEditor(item) {
  const required = batteryRequired(item.equipment_type, item.required_battery_count);
  const batteryLabel = required > 0 ? '<div class="small">Required battery / battery-box count: <b>' + required + '</b></div>' : '<div class="small">No battery count required for this equipment type.</div>';
  const delivery = item.purpose === 'DELIVERY' ?
    '<div class="deliveryChecks"><div class="subhead">Correct DELIVERY Readiness</div>' +
      correctionCheck('cos-sim', 'SIM installed / active', item.delivery_sim_ok) +
      correctionCheck('cos-cam', 'Camera visible in app', item.delivery_camera_app_ok) +
      correctionCheck('cos-sd', 'SD card formatted', item.delivery_sd_formatted_ok) +
      correctionCheck('cos-recording', 'Recording confirmed', item.delivery_recording_ok) +
      correctionCheck('cos-charged', 'Batteries / battery box charged', item.delivery_batteries_charged_ok) +
      correctionCheck('cos-monitor', 'Central Station monitoring created / sent', item.delivery_monitoring_ok) +
      correctionCheck('cos-ticket-count', 'Equipment / count matches MHelpDesk', item.delivery_ticket_count_ok) +
    '</div>' : '';
  return '<details class="top10 cos-verify-editor"><summary><b>Correct unit tag, counts, or IT checks</b></summary>' +
    '<div class="unitForm">' +
      '<label>Exact Unit Tag</label><input class="cos-unit-tag" value="' + editEsc(item.unit_tag || '') + '" placeholder="Unit tag">' +
      (required > 0 ? '<label class="top8">Batteries / Battery Box Prepared</label><input class="cos-battery-count" type="number" min="0" value="' + Number(item.battery_count ?? required) + '">' : '<input class="cos-battery-count" type="hidden" value="0">') +
      batteryLabel +
      correctionCheck('cos-power', 'Powers on correctly', item.power_ok) +
      correctionCheck('cos-functions', 'Functions tested and working', item.functions_ok) +
      correctionCheck('cos-safe', 'Safe for field use', item.safe_ok) +
      delivery +
      '<button class="mini full top8 cos-save-verification" type="button" data-item-id="' + item.id + '">Save Verification Correction</button>' +
      '<div class="small top8">You can save an incomplete correction. Equipment cannot be released until all required checks are complete.</div>' +
    '</div></details>';
}

function correctionCheck(cls, label, value) {
  return '<div class="check"><input class="' + cls + '" type="checkbox"' + (value ? ' checked' : '') + '><div><b>' + editEsc(label) + '</b></div></div>';
}

function draftPrepEditor(prep) {
  const items = [...(prep.prep_items || [])].sort((a, b) => a.item_order - b.item_order);
  return '<div class="item prepared" data-correction-prep="' + prep.id + '">' +
    '<div class="ticketHead"><div><b>MHelpDesk Ticket #' + editEsc(prep.ticket_no) + '</b><div class="small">Edit anything entered incorrectly before Service checkout.</div></div>' + statusBadge(prep.status) + '</div>' +
    '<div class="grid top10"><div><label>MHelpDesk Ticket #</label><input class="cos-ticket" value="' + editEsc(prep.ticket_no) + '"></div><div><label>Customer / Site / Description</label><input class="cos-site" value="' + editEsc(prep.site || '') + '" placeholder="Customer, site, or description"></div></div>' +
    '<div class="subhead">Equipment Rows</div><div class="small">Change type, purpose, or Recon battery requirement; remove rows; or add more rows. Structural changes reset that row’s prior IT verification so it can be checked again.</div>' +
    '<div class="cos-rows">' + items.map(i => structuralRow(i, prep.id)).join('') + '</div>' +
    '<div class="unitForm top10"><b>Add Equipment</b><div class="grid4 top8"><div><label>Type</label><select class="cos-add-type">' + equipmentOptions('Sniper') + '</select></div><div><label>Purpose</label><select class="cos-add-purpose">' + purposeOptions('BACKUP') + '</select></div><div><label>Qty</label><input class="cos-add-qty" type="number" min="1" value="1"></div><div class="cos-add-recon-wrap" style="display:none"><label>Recon Batteries</label><input class="cos-add-recon" type="number" min="1" value="1"></div></div><button class="mini full top8 cos-add-row" type="button">Add Equipment Row(s)</button></div>' +
    '<div class="row top10"><button class="btn cos-save-structure" type="button">Save Ticket & Equipment Changes</button><button class="mini danger cos-delete-prep" type="button">Remove Entire Prep</button></div>' +
  '</div>';
}

function releasedPrepEditor(prep) {
  const items = [...(prep.prep_items || [])].sort((a, b) => a.item_order - b.item_order);
  return '<div class="item prepared" data-correction-prep="' + prep.id + '">' +
    '<div class="ticketHead"><div><b>MHelpDesk Ticket #' + editEsc(prep.ticket_no) + '</b><div class="small">' + editEsc(prep.site || 'No site / description') + '</div></div>' + statusBadge(prep.status) + '</div>' +
    '<div class="small top8">Released equipment must be reopened before IT changes it. Reopening immediately removes it from Service checkout until IT verifies and releases it again.</div>' +
    '<div class="top8">' + items.map(i => '<div class="small">' + editEsc(i.purpose) + ' · ' + editEsc(i.equipment_type === 'Recon 2' ? 'Recon II' : i.equipment_type) + ' · ' + editEsc(i.unit_tag || 'no unit tag') + '</div>').join('') + '</div>' +
    '<div class="row top10"><button class="btn cos-reopen-prep" type="button">Reopen for IT Changes</button><button class="mini danger cos-delete-prep" type="button">Remove Entire Prep</button></div>' +
  '</div>';
}

async function renderITCorrections() {
  if (correctionRendering || !editRoleAllowed()) return;
  const view = document.getElementById('view-it');
  if (!view) return;
  correctionRendering = true;
  try {
    let card = document.getElementById('itCorrectionCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'itCorrectionCard';
      card.className = 'card';
      const first = view.querySelector(':scope > .card');
      if (first) first.after(card); else view.prepend(card);
      wireCorrectionEvents(card);
    }
    card.innerHTML = '<div class="sectiontitle"><h2>IT Corrections / Edit Active Prep</h2><span class="pill">Editable</span></div><div class="small">Fix ticket numbers, customer/site descriptions, equipment rows, quantities, Recon battery counts, unit tags, battery counts, and IT / DELIVERY checks. Completed Service verifications stay locked.</div><div id="itCorrectionList"><div class="warn">Loading active IT prep…</div></div>';
    wireCorrectionEvents(card);
    const { data, error } = await editDb.from('prep_tickets').select('*,prep_items(*)').neq('status', 'closed').order('created_at', { ascending: true });
    const list = card.querySelector('#itCorrectionList');
    if (error) {
      list.innerHTML = '<div class="bad">Could not load editable IT prep: ' + editEsc(error.message) + '</div>';
      return;
    }
    const preps = data || [];
    list.innerHTML = preps.length ? preps.map(p => p.status === 'released' ? releasedPrepEditor(p) : draftPrepEditor(p)).join('') : '<div class="ok">No active IT equipment prep to correct.</div>';
  } finally {
    correctionRendering = false;
  }
}

function wireCorrectionEvents(card) {
  if (card.dataset.wired === 'true') return;
  card.dataset.wired = 'true';
  card.addEventListener('change', e => {
    if (e.target.matches('.cos-eq')) {
      const row = e.target.closest('.cos-struct-row');
      const wrap = row?.querySelector('.cos-recon-wrap');
      if (wrap) wrap.style.display = e.target.value === 'Recon 2' ? '' : 'none';
    }
    if (e.target.matches('.cos-add-type')) {
      const prep = e.target.closest('[data-correction-prep]');
      const wrap = prep?.querySelector('.cos-add-recon-wrap');
      if (wrap) wrap.style.display = e.target.value === 'Recon 2' ? '' : 'none';
    }
  });
  card.addEventListener('click', async e => {
    const prepEl = e.target.closest('[data-correction-prep]');
    if (!prepEl) return;
    const prepId = prepEl.dataset.correctionPrep;
    if (e.target.closest('.cos-remove-row')) {
      e.target.closest('.cos-struct-row')?.remove();
      return;
    }
    if (e.target.closest('.cos-add-row')) {
      const type = prepEl.querySelector('.cos-add-type').value;
      const purpose = prepEl.querySelector('.cos-add-purpose').value;
      const qty = Math.max(1, Number(prepEl.querySelector('.cos-add-qty').value || 1));
      const required = type === 'Recon 2' ? Math.max(1, Number(prepEl.querySelector('.cos-add-recon').value || 1)) : batteryRequired(type, 0);
      const rows = prepEl.querySelector('.cos-rows');
      for (let i = 0; i < qty; i++) rows.insertAdjacentHTML('beforeend', structuralRow({ equipment_type: type, purpose, required_battery_count: required }, prepId, true));
      return;
    }
    if (e.target.closest('.cos-save-structure')) {
      await saveStructure(prepEl, prepId);
      return;
    }
    if (e.target.closest('.cos-save-verification')) {
      await saveVerification(e.target.closest('.cos-struct-row'));
      return;
    }
    if (e.target.closest('.cos-reopen-prep')) {
      if (!confirm('Reopen this released equipment prep? It will immediately disappear from Service checkout until IT releases it again.')) return;
      await runRpc('reopen_it_prep', { p_prep_id: prepId }, 'Equipment prep reopened for IT changes.');
      return;
    }
    if (e.target.closest('.cos-delete-prep')) {
      const ticket = prepEl.querySelector('.cos-ticket')?.value || prepEl.querySelector('b')?.textContent || 'this prep';
      if (!confirm('Remove ' + ticket + ' from Tech Check? This deletes the active equipment prep and its equipment rows.')) return;
      await runRpc('delete_it_prep', { p_prep_id: prepId }, 'Active IT equipment prep removed.');
    }
  });
}

async function saveStructure(prepEl, prepId) {
  const ticket = prepEl.querySelector('.cos-ticket').value.trim();
  const site = prepEl.querySelector('.cos-site').value.trim();
  const rows = [...prepEl.querySelectorAll('.cos-struct-row')];
  if (!ticket) return alert('Enter the MHelpDesk ticket number.');
  if (!rows.length) return alert('Keep at least one equipment row, or use Remove Entire Prep.');
  const items = rows.map(row => {
    const type = row.querySelector('.cos-eq').value;
    return {
      id: row.dataset.itemId || null,
      equipment_type: type,
      purpose: row.querySelector('.cos-purpose').value,
      required_battery_count: type === 'Recon 2' ? Math.max(1, Number(row.querySelector('.cos-required')?.value || 1)) : batteryRequired(type, 0)
    };
  });
  await runRpc('update_it_prep_structure', { p_prep_id: prepId, p_ticket_no: ticket, p_site: site, p_items: items }, 'Ticket and equipment changes saved.');
}

async function saveVerification(row) {
  if (!row?.dataset.itemId) return;
  const delivery = row.querySelector('.cos-purpose')?.value === 'DELIVERY';
  const args = {
    p_item_id: row.dataset.itemId,
    p_unit_tag: row.querySelector('.cos-unit-tag')?.value || '',
    p_battery_count: Number(row.querySelector('.cos-battery-count')?.value || 0),
    p_power_ok: !!row.querySelector('.cos-power')?.checked,
    p_functions_ok: !!row.querySelector('.cos-functions')?.checked,
    p_safe_ok: !!row.querySelector('.cos-safe')?.checked,
    p_sim_ok: delivery && !!row.querySelector('.cos-sim')?.checked,
    p_camera_app_ok: delivery && !!row.querySelector('.cos-cam')?.checked,
    p_batteries_charged_ok: delivery && !!row.querySelector('.cos-charged')?.checked,
    p_monitoring_ok: delivery && !!row.querySelector('.cos-monitor')?.checked,
    p_ticket_count_ok: delivery && !!row.querySelector('.cos-ticket-count')?.checked,
    p_sd_formatted_ok: delivery && !!row.querySelector('.cos-sd')?.checked,
    p_recording_ok: delivery && !!row.querySelector('.cos-recording')?.checked
  };
  await runRpc('save_it_prep_item_draft', args, 'IT verification correction saved.');
}

async function runRpc(name, args, successMessage) {
  document.body.classList.add('busy');
  const { error } = await editDb.rpc(name, args);
  document.body.classList.remove('busy');
  if (error) return alert(error.message);
  if (successMessage) alert(successMessage);
  if (typeof window.refreshData === 'function') await window.refreshData();
  await renderITCorrections();
}

function restyleOwnerReset() {
  const card = document.getElementById('ownerResetCard');
  if (!card) return;
  const h2 = card.querySelector('h2');
  if (h2) h2.textContent = 'Reset All Workflow Data';
  const warning = card.querySelector('.warn');
  if (warning) warning.innerHTML = '<b>Owner only — full operational reset.</b><div class="small">Clears ALL draft, released, and completed equipment prep; Service checkout verification history; Owner reports; and morning checks. Technician accounts, usernames, roles, and passwords are preserved.</div>';
  const button = card.querySelector('button');
  if (button) button.textContent = 'Reset Everything — Keep Technician Accounts';
}

function scheduleCorrections() {
  clearTimeout(correctionRenderTimer);
  correctionRenderTimer = setTimeout(() => {
    restyleOwnerReset();
    renderITCorrections();
  }, 120);
}

function installCorrectionObservers() {
  const itPreps = document.getElementById('itPreps');
  const owner = document.getElementById('view-owner');
  const role = document.getElementById('whoRole');
  if (itPreps) new MutationObserver(scheduleCorrections).observe(itPreps, { childList: true, subtree: true });
  if (owner) new MutationObserver(() => restyleOwnerReset()).observe(owner, { childList: true, subtree: true });
  if (role) new MutationObserver(scheduleCorrections).observe(role, { childList: true, characterData: true, subtree: true });
  scheduleCorrections();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCorrectionObservers);
else installCorrectionObservers();
