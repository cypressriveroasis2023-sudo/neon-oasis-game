const editDb = window.__techCheckDb;

const EDIT_TYPES = [
  'Sniper',
  'Ranger',
  'Helios',
  'Solar Spotter',
  'Spotter',
  'Recon 2',
  '110V Stand',
  'Solar Stand',
];
const EDIT_PURPOSES = ['BACKUP', 'SWAP', 'DELIVERY'];
const FIXED_BATTERIES = {
  Sniper: 2,
  Ranger: 1,
  Helios: 1,
  'Solar Spotter': 4,
  Spotter: 0,
  '110V Stand': 0,
  'Solar Stand': 0,
};

let prepObserver = null;
let renderTimer = null;
let renderingUnified = false;

function editEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[c]);
}

function editRoleAllowed() {
  const role = document.getElementById('whoRole')?.textContent || '';
  return role.includes('IT Tech') || role.includes('Owner/Admin');
}

function allowedPurposes(type) {
  if (type === '110V Stand') return ['SWAP'];
  if (type === 'Solar Stand') return ['SWAP', 'DELIVERY'];
  return EDIT_PURPOSES;
}

function equipmentOptions(selected) {
  return EDIT_TYPES.map(type =>
    '<option value="' + editEsc(type) + '"' +
    (type === selected ? ' selected' : '') + '>' +
    editEsc(type === 'Recon 2' ? 'Recon II' : type) +
    '</option>'
  ).join('');
}

function purposeOptions(type, selected) {
  const allowed = allowedPurposes(type);
  const picked = allowed.includes(selected) ? selected : allowed[0];
  return allowed.map(p =>
    '<option value="' + p + '"' +
    (p === picked ? ' selected' : '') + '>' + p + '</option>'
  ).join('');
}

function batteryRequired(type, stored) {
  if (type === 'Recon 2') return Math.max(1, Number(stored || 1));
  return Number(FIXED_BATTERIES[type] || 0);
}

function checked(value) {
  return value ? ' checked' : '';
}

function statusBadge(status) {
  if (status === 'draft') return '<span class="pill amber">IT EQUIPMENT PREP</span>';
  if (status === 'released') return '<span class="pill green">READY FOR SERVICE CHECKOUT</span>';
  return '<span class="pill">EQUIPMENT VERIFIED</span>';
}

function deliveryChecks(item = {}) {
  if (item.purpose !== 'DELIVERY') return '';
  return (
    '<div class="deliveryChecks">' +
      '<div class="subhead">DELIVERY Readiness</div>' +
      '<div class="small">Complete all seven checks before releasing this DELIVERY item to Service.</div>' +
      correctionCheck('cos-sim', 'SIM card active and installed in router', item.delivery_sim_ok) +
      correctionCheck('cos-cam', 'Camera is visible in the camera app', item.delivery_camera_app_ok) +
      correctionCheck('cos-sd', 'SD card formatted', item.delivery_sd_formatted_ok) +
      correctionCheck('cos-recording', 'Recording footage confirmed', item.delivery_recording_ok) +
      correctionCheck('cos-charged', 'Batteries / battery box charged and ready', item.delivery_batteries_charged_ok) +
      correctionCheck('cos-monitor', 'Central Station monitoring created and sent in', item.delivery_monitoring_ok) +
      correctionCheck('cos-ticket-count', 'Equipment type and quantity match MHelpDesk', item.delivery_ticket_count_ok) +
    '</div>'
  );
}

function correctionCheck(cls, label, value) {
  return (
    '<div class="check">' +
      '<input class="' + cls + '" type="checkbox"' + checked(value) + '>' +
      '<div><b>' + editEsc(label) + '</b></div>' +
    '</div>'
  );
}

function editableRow(item, prepId, temporary = false) {
  const type = item.equipment_type || 'Sniper';
  const purposeAllowed = allowedPurposes(type);
  const purpose = purposeAllowed.includes(item.purpose) ? item.purpose : purposeAllowed[0];
  const required = batteryRequired(type, item.required_battery_count);
  const itemId = temporary ? '' : (item.id || '');

  return (
    '<div class="item cos-struct-row" data-prep-id="' + prepId + '" data-item-id="' + editEsc(itemId) + '">' +
      '<div class="grid3">' +
        '<div>' +
          '<label>Equipment Type</label>' +
          '<select class="cos-eq">' + equipmentOptions(type) + '</select>' +
        '</div>' +
        '<div>' +
          '<label>Purpose</label>' +
          '<select class="cos-purpose">' + purposeOptions(type, purpose) + '</select>' +
        '</div>' +
        '<div class="cos-recon-wrap"' + (type === 'Recon 2' ? '' : ' style="display:none"') + '>' +
          '<label>Recon Battery Count</label>' +
          '<input class="cos-required" type="number" min="1" value="' + required + '">' +
        '</div>' +
      '</div>' +

      '<div class="subhead">Unit & IT Verification</div>' +
      '<label>Exact Unit Tag</label>' +
      '<input class="cos-unit-tag" value="' + editEsc(item.unit_tag || '') + '" placeholder="Unit tag">' +

      (required > 0
        ? '<label class="top8">Batteries / Battery Box Prepared</label>' +
          '<input class="cos-battery-count" type="number" min="0" value="' +
          Number(item.battery_count ?? required) + '">' +
          '<div class="small">Required for this item: <b>' + required + '</b>.</div>'
        : '<input class="cos-battery-count" type="hidden" value="0">') +

      correctionCheck('cos-power', 'Powers on correctly', item.power_ok) +
      correctionCheck('cos-functions', 'Functions tested and working', item.functions_ok) +
      correctionCheck('cos-safe', 'Safe for field use', item.safe_ok) +
      deliveryChecks({ ...item, purpose }) +

      '<div class="row top10">' +
        '<span class="small">' +
          (temporary
            ? 'New equipment row — Save Changes to add it.'
            : 'Current unit: ' + editEsc(item.unit_tag || 'not assigned')) +
        '</span>' +
        '<button class="mini danger cos-remove-row" type="button">Remove Row</button>' +
      '</div>' +
    '</div>'
  );
}

function unifiedDraftCard(prep) {
  const items = [...(prep.prep_items || [])].sort((a, b) => a.item_order - b.item_order);

  return (
    '<div class="ticketHead">' +
      '<div>' +
        '<b>MHelpDesk Ticket #' + editEsc(prep.ticket_no) + '</b>' +
        '<div class="small">Everything for this prep is edited and verified here.</div>' +
      '</div>' +
      statusBadge(prep.status) +
    '</div>' +

    '<div class="grid top10">' +
      '<div>' +
        '<label>MHelpDesk Ticket #</label>' +
        '<input class="cos-ticket" value="' + editEsc(prep.ticket_no) + '">' +
      '</div>' +
      '<div>' +
        '<label>Customer / Site / Description</label>' +
        '<input class="cos-site" value="' + editEsc(prep.site || '') + '" placeholder="Customer, site, or description">' +
      '</div>' +
    '</div>' +

    '<div class="subhead">Equipment & Verification</div>' +
    '<div class="small">Each equipment row is fully expanded. Fix the type, purpose, unit tag, counts, or checks directly here.</div>' +
    '<div class="cos-rows">' +
      items.map(item => editableRow(item, prep.id)).join('') +
    '</div>' +

    '<div class="unitForm top10">' +
      '<b>Add Equipment</b>' +
      '<div class="grid4 top8">' +
        '<div><label>Type</label><select class="cos-add-type">' + equipmentOptions('Sniper') + '</select></div>' +
        '<div><label>Purpose</label><select class="cos-add-purpose">' + purposeOptions('Sniper', 'BACKUP') + '</select></div>' +
        '<div><label>Qty</label><input class="cos-add-qty" type="number" min="1" value="1"></div>' +
        '<div class="cos-add-recon-wrap" style="display:none">' +
          '<label>Recon Batteries</label><input class="cos-add-recon" type="number" min="1" value="1">' +
        '</div>' +
      '</div>' +
      '<button class="mini full top8 cos-add-row" type="button">Add Equipment Row(s)</button>' +
    '</div>' +

    '<div class="row top10">' +
      '<button class="mini full cos-save-all" type="button">Save Changes</button>' +
      '<button class="btn cos-release-all" type="button">Verify & Release Equipment to Service Tech</button>' +
      '<button class="mini danger cos-delete-prep" type="button">Remove Entire Prep</button>' +
    '</div>'
  );
}

function unifiedReleasedCard(prep) {
  const items = [...(prep.prep_items || [])].sort((a, b) => a.item_order - b.item_order);

  return (
    '<div class="ticketHead">' +
      '<div>' +
        '<b>MHelpDesk Ticket #' + editEsc(prep.ticket_no) + '</b>' +
        '<div class="small">' + editEsc(prep.site || 'No site / description') + '</div>' +
      '</div>' +
      statusBadge(prep.status) +
    '</div>' +
    '<div class="ok top10">' +
      '<b>Released to Service.</b>' +
      '<div class="small">If IT needs to correct anything, reopen this prep. It will be removed from Service checkout until IT verifies and releases it again.</div>' +
    '</div>' +
    '<div class="top10">' +
      items.map(item =>
        '<div class="item">' +
          '<div class="row">' +
            '<span class="pill ' + (item.purpose === 'DELIVERY' ? 'delivery' : item.purpose === 'SWAP' ? 'swap' : 'backup') + '">' +
              editEsc(item.purpose) +
            '</span>' +
            '<b>' + editEsc(item.equipment_type === 'Recon 2' ? 'Recon II' : item.equipment_type) + '</b>' +
          '</div>' +
          '<div class="small">Unit: ' + editEsc(item.unit_tag || 'not assigned') + '</div>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<div class="row top10">' +
      '<button class="btn cos-reopen-prep" type="button">Reopen for IT Changes</button>' +
      '<button class="mini danger cos-delete-prep" type="button">Remove Entire Prep</button>' +
    '</div>'
  );
}

function syncPurposeSelect(typeSelect, purposeSelect) {
  if (!typeSelect || !purposeSelect) return;
  const type = typeSelect.value;
  const current = purposeSelect.value;
  purposeSelect.innerHTML = purposeOptions(type, current);

  const wrap = typeSelect.closest('.cos-struct-row')?.querySelector('.cos-recon-wrap');
  if (wrap) wrap.style.display = type === 'Recon 2' ? '' : 'none';

  const addWrap = typeSelect.closest('[data-prep-id]')?.querySelector('.cos-add-recon-wrap');
  if (addWrap && typeSelect.classList.contains('cos-add-type')) {
    addWrap.style.display = type === 'Recon 2' ? '' : 'none';
  }
}

function setupCreateFormOptions() {
  const type = document.getElementById('needType');
  const purpose = document.getElementById('needPurpose');
  if (!type || !purpose) return;

  ['110V Stand', 'Solar Stand'].forEach(value => {
    if (![...type.options].some(o => o.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      type.appendChild(option);
    }
  });

  const sync = () => {
    const current = purpose.value;
    purpose.innerHTML = purposeOptions(type.value, current);
    if (typeof window.toggleReconBatteryInput === 'function') window.toggleReconBatteryInput();
  };

  if (type.dataset.standRulesWired !== 'true') {
    type.dataset.standRulesWired = 'true';
    type.addEventListener('change', sync);
  }
  sync();
}

async function fetchPreps() {
  return await editDb
    .from('prep_tickets')
    .select('*,prep_items(*)')
    .order('created_at', { ascending: true });
}

function observePrepList() {
  const list = document.getElementById('itPreps');
  if (!list) return;
  if (!prepObserver) {
    prepObserver = new MutationObserver(() => scheduleUnifiedRender());
  }
  prepObserver.disconnect();
  prepObserver.observe(list, { childList: true });
}

async function renderUnifiedPreps() {
  if (renderingUnified || !editDb || !editRoleAllowed()) return;
  const list = document.getElementById('itPreps');
  if (!list) return;

  renderingUnified = true;
  prepObserver?.disconnect();

  try {
    const { data, error } = await fetchPreps();
    if (error) return;

    const preps = data || [];
    const cards = [...list.children].filter(el => el.classList.contains('prepared'));

    cards.forEach((card, index) => {
      const prep = preps[index];
      if (!prep) return;
      card.dataset.prepId = prep.id;

      if (prep.status === 'draft') {
        card.innerHTML = unifiedDraftCard(prep);
      } else if (prep.status === 'released') {
        card.innerHTML = unifiedReleasedCard(prep);
      }
    });
  } finally {
    renderingUnified = false;
    observePrepList();
  }
}

function scheduleUnifiedRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    setupCreateFormOptions();
    restyleOwnerReset();
    renderUnifiedPreps();
  }, 80);
}

function wireUnifiedEvents() {
  const list = document.getElementById('itPreps');
  if (!list || list.dataset.unifiedWired === 'true') return;
  list.dataset.unifiedWired = 'true';

  list.addEventListener('change', event => {
    if (event.target.matches('.cos-eq')) {
      const row = event.target.closest('.cos-struct-row');
      syncPurposeSelect(event.target, row?.querySelector('.cos-purpose'));
      const item = {};
      item.purpose = row?.querySelector('.cos-purpose')?.value;
      const existing = row?.querySelector('.deliveryChecks');
      if (item.purpose === 'DELIVERY' && !existing) {
        const anchor = row.querySelector('.cos-safe')?.closest('.check');
        anchor?.insertAdjacentHTML('afterend', deliveryChecks(item));
      } else if (item.purpose !== 'DELIVERY' && existing) {
        existing.remove();
      }
    }

    if (event.target.matches('.cos-purpose')) {
      const row = event.target.closest('.cos-struct-row');
      const existing = row?.querySelector('.deliveryChecks');
      if (event.target.value === 'DELIVERY' && !existing) {
        const anchor = row.querySelector('.cos-safe')?.closest('.check');
        anchor?.insertAdjacentHTML('afterend', deliveryChecks({ purpose: 'DELIVERY' }));
      } else if (event.target.value !== 'DELIVERY' && existing) {
        existing.remove();
      }
    }

    if (event.target.matches('.cos-add-type')) {
      const card = event.target.closest('[data-prep-id]');
      syncPurposeSelect(event.target, card?.querySelector('.cos-add-purpose'));
      const wrap = card?.querySelector('.cos-add-recon-wrap');
      if (wrap) wrap.style.display = event.target.value === 'Recon 2' ? '' : 'none';
    }
  });

  list.addEventListener('click', async event => {
    const card = event.target.closest('[data-prep-id]');
    if (!card) return;
    const prepId = card.dataset.prepId;

    if (event.target.closest('.cos-remove-row')) {
      event.target.closest('.cos-struct-row')?.remove();
      return;
    }

    if (event.target.closest('.cos-add-row')) {
      const type = card.querySelector('.cos-add-type').value;
      const purpose = card.querySelector('.cos-add-purpose').value;
      const qty = Math.max(1, Number(card.querySelector('.cos-add-qty').value || 1));
      const required = type === 'Recon 2'
        ? Math.max(1, Number(card.querySelector('.cos-add-recon').value || 1))
        : batteryRequired(type, 0);
      const rows = card.querySelector('.cos-rows');
      for (let i = 0; i < qty; i++) {
        rows.insertAdjacentHTML(
          'beforeend',
          editableRow(
            {
              equipment_type: type,
              purpose,
              required_battery_count: required,
              battery_count: required,
            },
            prepId,
            true
          )
        );
      }
      return;
    }

    if (event.target.closest('.cos-save-all')) {
      await saveUnifiedCard(card, false);
      return;
    }

    if (event.target.closest('.cos-release-all')) {
      await saveUnifiedCard(card, true);
      return;
    }

    if (event.target.closest('.cos-reopen-prep')) {
      if (!confirm('Reopen this released equipment prep? It will be removed from Service checkout until IT verifies and releases it again.')) return;
      await runRpc('reopen_it_prep', { p_prep_id: prepId }, 'Equipment prep reopened for IT changes.');
      return;
    }

    if (event.target.closest('.cos-delete-prep')) {
      const ticket = card.querySelector('.cos-ticket')?.value || card.querySelector('b')?.textContent || 'this prep';
      if (!confirm('Remove ' + ticket + ' from Tech Check? This deletes the active equipment prep and its equipment rows.')) return;
      await runRpc('delete_it_prep', { p_prep_id: prepId }, 'Active IT equipment prep removed.');
    }
  });
}

function collectRow(row) {
  const type = row.querySelector('.cos-eq').value;
  const purpose = row.querySelector('.cos-purpose').value;
  const required = type === 'Recon 2'
    ? Math.max(1, Number(row.querySelector('.cos-required')?.value || 1))
    : batteryRequired(type, 0);

  return {
    structure: {
      id: row.dataset.itemId || null,
      equipment_type: type,
      purpose,
      required_battery_count: required,
    },
    verification: {
      unit_tag: row.querySelector('.cos-unit-tag')?.value.trim() || '',
      battery_count: Number(row.querySelector('.cos-battery-count')?.value || 0),
      power_ok: !!row.querySelector('.cos-power')?.checked,
      functions_ok: !!row.querySelector('.cos-functions')?.checked,
      safe_ok: !!row.querySelector('.cos-safe')?.checked,
      sim_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-sim')?.checked,
      camera_app_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-cam')?.checked,
      batteries_charged_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-charged')?.checked,
      monitoring_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-monitor')?.checked,
      ticket_count_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-ticket-count')?.checked,
      sd_formatted_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-sd')?.checked,
      recording_ok: purpose === 'DELIVERY' && !!row.querySelector('.cos-recording')?.checked,
    },
  };
}

function validateForRelease(rows) {
  for (const row of rows) {
    const s = row.structure;
    const v = row.verification;
    const label = s.equipment_type === 'Recon 2' ? 'Recon II' : s.equipment_type;

    if (!v.unit_tag) return 'Enter the exact unit tag for ' + label + '.';
    if (!v.power_ok || !v.functions_ok || !v.safe_ok) {
      return 'Complete all three IT verification checks for ' + label + '.';
    }
    if (v.battery_count < Number(s.required_battery_count || 0)) {
      return label + ' needs the required battery / battery-box count before release.';
    }
    if (s.purpose === 'DELIVERY') {
      const allDelivery = v.sim_ok && v.camera_app_ok && v.batteries_charged_ok &&
        v.monitoring_ok && v.ticket_count_ok && v.sd_formatted_ok && v.recording_ok;
      if (!allDelivery) return 'Complete all seven DELIVERY readiness checks for ' + label + '.';
    }
  }
  return '';
}

async function saveUnifiedCard(card, releaseAfterSave) {
  const prepId = card.dataset.prepId;
  const ticket = card.querySelector('.cos-ticket')?.value.trim() || '';
  const site = card.querySelector('.cos-site')?.value.trim() || '';
  const rows = [...card.querySelectorAll('.cos-struct-row')].map(collectRow);

  if (!ticket) return alert('Enter the MHelpDesk ticket number.');
  if (!rows.length) return alert('Keep at least one equipment row, or use Remove Entire Prep.');

  if (releaseAfterSave) {
    const issue = validateForRelease(rows);
    if (issue) return alert(issue);
  }

  document.body.classList.add('busy');
  try {
    const { error: structureError } = await editDb.rpc('update_it_prep_structure', {
      p_prep_id: prepId,
      p_ticket_no: ticket,
      p_site: site,
      p_items: rows.map(r => r.structure),
    });
    if (structureError) return alert(structureError.message);

    const { data: fresh, error: loadError } = await editDb
      .from('prep_tickets')
      .select('*,prep_items(*)')
      .eq('id', prepId)
      .single();
    if (loadError) return alert(loadError.message);

    const freshItems = [...(fresh.prep_items || [])].sort((a, b) => a.item_order - b.item_order);
    if (freshItems.length !== rows.length) {
      return alert('The equipment list changed while saving. Refresh and try again.');
    }

    for (let i = 0; i < freshItems.length; i++) {
      const v = rows[i].verification;
      const { error } = await editDb.rpc('save_it_prep_item_draft', {
        p_item_id: freshItems[i].id,
        p_unit_tag: v.unit_tag,
        p_battery_count: v.battery_count,
        p_power_ok: v.power_ok,
        p_functions_ok: v.functions_ok,
        p_safe_ok: v.safe_ok,
        p_sim_ok: v.sim_ok,
        p_camera_app_ok: v.camera_app_ok,
        p_batteries_charged_ok: v.batteries_charged_ok,
        p_monitoring_ok: v.monitoring_ok,
        p_ticket_count_ok: v.ticket_count_ok,
        p_sd_formatted_ok: v.sd_formatted_ok,
        p_recording_ok: v.recording_ok,
      });
      if (error) return alert(error.message);
    }

    if (releaseAfterSave) {
      const { error: releaseError } = await editDb.rpc('release_prep', {
        p_prep_id: prepId,
      });
      if (releaseError) return alert(releaseError.message);
      alert('Equipment verified and released to Service Tech checkout.');
    } else {
      alert('Changes saved.');
    }
  } finally {
    document.body.classList.remove('busy');
  }

  if (typeof window.refreshData === 'function') await window.refreshData();
  scheduleUnifiedRender();
}

async function runRpc(name, args, successMessage) {
  document.body.classList.add('busy');
  try {
    const { error } = await editDb.rpc(name, args);
    if (error) return alert(error.message);
    if (successMessage) alert(successMessage);
  } finally {
    document.body.classList.remove('busy');
  }
  if (typeof window.refreshData === 'function') await window.refreshData();
  scheduleUnifiedRender();
}

function restyleOwnerReset() {
  const card = document.getElementById('ownerResetCard');
  if (!card) return;
  const h2 = card.querySelector('h2');
  if (h2) h2.textContent = 'Reset All Workflow Data';
  const warning = card.querySelector('.warn');
  if (warning) {
    warning.innerHTML =
      '<b>Owner only — full operational reset.</b>' +
      '<div class="small">Clears ALL draft, released, and completed equipment prep; Service checkout verification history; Owner reports; and morning checks. Technician accounts, usernames, roles, and passwords are preserved.</div>';
  }
  const button = card.querySelector('button');
  if (button) button.textContent = 'Reset Everything — Keep Technician Accounts';
}

function removeOldCorrectionCard() {
  document.getElementById('itCorrectionCard')?.remove();
}

function installUnifiedIT() {
  removeOldCorrectionCard();
  setupCreateFormOptions();
  wireUnifiedEvents();
  observePrepList();
  restyleOwnerReset();
  scheduleUnifiedRender();

  const role = document.getElementById('whoRole');
  if (role) {
    new MutationObserver(scheduleUnifiedRender).observe(role, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installUnifiedIT);
} else {
  installUnifiedIT();
}
