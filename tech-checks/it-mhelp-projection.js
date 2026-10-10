// Read-only display projection for the existing my_managed_tickets_v1 result.
// Authorization belongs to the host and the RPC. Never forward whole records.
const MAX_TICKETS = 5000;
const MAX_EQUIPMENT = 100;
const invalid = () => { throw new Error('MHelp ticket information is unavailable.'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, maximum) {
  if (value == null) return '';
  if (typeof value !== 'string') return invalid();
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (cleaned.length > maximum) return invalid();
  return cleaned;
}
function date(value) {
  const result = text(value, 10);
  if (!result) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return invalid();
  const parsed = new Date(result + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) return invalid();
  return result;
}
function time(value) {
  const result = text(value, 20);
  if (result && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(result)) return invalid();
  return result;
}
function equipment(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EQUIPMENT) return invalid();
  return Array.from(raw).map(item => {
    if (!record(item)) return invalid();
    const label = text(item.label, 160);
    // Only the recorded label and quantity can cross this bridge. No URLs,
    // notes, serial numbers, configuration, price or nested manifest fields.
    if (!label || /https?:\/\/|[<>]/i.test(label)) return invalid();
    const quantity = typeof item.qty === 'number' ? item.qty : typeof item.qty === 'string' && /^\d+$/.test(item.qty) ? Number(item.qty) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) return invalid();
    return `${quantity} × ${label === 'Recon 2' ? 'Recon II' : label}`;
  });
}

export function projectITMhelpTickets(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_TICKETS) return invalid();
  const seen = new Set();
  return Array.from(rows).map(row => {
    if (!record(row)) return invalid();
    const ticketNumber = text(typeof row.ticket_no === 'number' && Number.isSafeInteger(row.ticket_no) && row.ticket_no >= 0 ? String(row.ticket_no) : row.ticket_no, 80);
    if (!ticketNumber || seen.has(ticketNumber) || typeof row.all_finished !== 'boolean') return invalid();
    seen.add(ticketNumber);
    return {
      ticketNumber,
      site: text(row.site, 300),
      workType: text(row.work_type, 80),
      scheduledFor: date(row.scheduled_for),
      scheduledTime: time(row.scheduled_time),
      finished: row.all_finished,
      equipment: equipment(row.equipment_manifest),
    };
  });
}

// Separate read-only projection of the existing authenticated IT assignment RPC.
// A Ticket Lead is deliberately not required, and no import origin is inferred.
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function exactText(value, maximum, multiline = false) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > maximum || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return invalid();
  return value;
}
export function projectITAssignments(rows, subject) {
  if (!uuid(subject) || !Array.isArray(rows) || rows.length > MAX_TICKETS) return invalid();
  const seen = new Set();
  return Array.from(rows).map(row => {
    if (!record(row) || !['ticket_no', 'site', 'work_type', 'scheduled_for', 'scheduled_time', 'equipment_manifest', 'unit_summary'].every(key => Object.hasOwn(row, key) && row[key] !== undefined) ||
        !uuid(row.id) || seen.has(row.id.toLowerCase()) || row.assigned_role !== 'it' ||
        !['assigned', 'started'].includes(row.status) || !['technician', 'department'].includes(row.assignment_scope)) return invalid();
    const mine = row.assignee_user_id === subject;
    if (!mine && !(row.assignee_user_id === null && row.assignment_scope === 'department' && row.status === 'assigned')) return invalid();
    const ticketNumber = exactText(row.ticket_no, 128);
    if (!ticketNumber.trim()) return invalid();
    seen.add(row.id.toLowerCase());
    return {
      assignmentId: row.id, ticketNumber, site: exactText(row.site, 500), workType: exactText(row.work_type, 80),
      scheduledFor: date(row.scheduled_for), scheduledTime: time(row.scheduled_time),
      status: row.status, audience: mine ? 'mine' : 'department', equipment: equipment(row.equipment_manifest),
      unitSummary: exactText(row.unit_summary, 2000, true),
    };
  });
}
