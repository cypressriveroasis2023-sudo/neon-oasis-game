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
  return raw.map(item => {
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
  return rows.map(row => {
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
