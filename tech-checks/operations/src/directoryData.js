const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const equipmentStatuses = Object.freeze(['new','available','prep','ready','assigned','in_transit','installed','returning','intake','repair','quarantine','retired']);
const definitions = Object.freeze({
  Customers: { endpoint: '/api/customers', title: 'Customer', primary: 'name',
    fields: ['name', 'legalName', 'notes', 'status'], required: ['name'] },
  Sites: { endpoint: '/api/sites', title: 'Site', primary: 'name',
    fields: ['customerId', 'name', 'addressLine1', 'addressLine2', 'city', 'stateRegion', 'postalCode', 'country', 'accessInstructions', 'parkingInstructions', 'safetyNotes', 'operationalNotes', 'status'],
    required: ['customerId', 'name'] },
  Equipment: { endpoint: '/api/equipment', title: 'Equipment unit', primary: 'unitNumber',
    fields: ['modelId', 'unitNumber', 'serialNumber', 'status', 'currentLocationType'],
    required: ['modelId', 'unitNumber', 'status'] },
});
export const directoryKinds = Object.freeze(Object.keys(definitions));
export function definition(kind) {
  const value = definitions[kind];
  if (!value) throw new Error('This directory is unavailable.');
  return value;
}
const text = value => value == null ? '' : typeof value === 'string' ? value.trim() : null;
const fieldName = key => ({ name: 'Name', customerId: 'Customer', modelId: 'Model',
  unitNumber: 'Unit number', serialNumber: 'Serial number', currentLocationType: 'Location type' }[key] || key);
export function records(data, label = 'Directory', primary = 'name') {
  if (!data || !Array.isArray(data.items) || data.items.some(row => !row || typeof row !== 'object' ||
      Array.isArray(row) || typeof row.id !== 'string' || !uuid.test(row.id) || typeof row[primary] !== 'string')) {
    throw new Error(label + ' returned an incomplete record list. Please retry.');
  }
  return data.items;
}
export function equipmentSnapshot(data) {
  const items = records(data, 'Equipment', 'unitNumber');
  if (!Array.isArray(data.models) || data.models.some(model => !model || typeof model !== 'object' ||
      typeof model.id !== 'string' || !uuid.test(model.id) || typeof model.name !== 'string')) {
    throw new Error('Equipment returned an incomplete model list. Please retry.');
  }
  return { items, models: data.models };
}
export function teamRecords(data) {
  if (!data || !Array.isArray(data.items) || data.items.some(member => !member || typeof member !== 'object' ||
      typeof member.userId !== 'string' || !uuid.test(member.userId) || typeof member.displayName !== 'string' ||
      !['it', 'service'].includes(String(member.department).toLowerCase()) || typeof member.active !== 'boolean')) {
    throw new Error('Team returned an incomplete production roster. Please retry.');
  }
  return data.items;
}
export function payloadFor(kind, draft) {
  const spec = definition(kind);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('A record is required.');
  const payload = Object.fromEntries(spec.fields.map(key => {
    const value = text(draft[key]);
    if (value === null) throw new Error(fieldName(key) + ' must be text.');
    return [key, value];
  }));
  for (const key of spec.required) if (!payload[key]) throw new Error(fieldName(key) + ' is required.');
  if (kind !== 'Equipment' && !['active', 'inactive'].includes(payload.status)) throw new Error('Choose Active or Inactive.');
  if (kind === 'Equipment' && !equipmentStatuses.includes(payload.status)) throw new Error('Choose a valid equipment status.');
  for (const key of ['customerId', 'modelId']) {
    if (key in payload && !uuid.test(payload[key])) throw new Error(fieldName(key) + ' must be selected from production records.');
  }
  if (draft.id != null && draft.id !== '' && (typeof draft.id !== 'string' || !uuid.test(draft.id))) throw new Error('The record identifier is invalid.');
  return payload;
}
export function matchesPayload(row, payload) {
  return Boolean(row && Object.entries(payload).every(([key, value]) => text(row[key]) === value));
}
export class DirectorySaveError extends Error {
  constructor(message, phase, recordId = null) {
    super(message); this.name = 'DirectorySaveError'; this.phase = phase; this.recordId = recordId;
  }
}
/** Issue exactly one write. Only a new authoritative snapshot can confirm success. */
export async function saveDirectory(client, kind, draft) {
  const spec = definition(kind);
  const payload = payloadFor(kind, draft);
  const previousId = draft.id || null;
  let result;
  try { result = await client.post(spec.endpoint + (previousId ? '/' + previousId : ''), payload); }
  catch (cause) {
    const status = cause?.response?.status;
    const certainRejection = Number.isInteger(status) && status >= 400 && status < 500;
    throw new DirectorySaveError(certainRejection ? (cause?.message || 'Record was rejected.')
      : 'The save could not be confirmed. Refresh records before trying again.', certainRejection ? 'rejected' : 'uncertain', previousId);
  }
  const id = result?.data?.id;
  if (typeof id !== 'string' || !uuid.test(id) || (previousId && id !== previousId)) {
    throw new DirectorySaveError('The server accepted the request but returned an unverified record identifier. Refresh records before trying again.', 'uncertain', previousId);
  }
  let data, items;
  try {
    data = (await client.get(spec.endpoint)).data;
    items = kind === 'Equipment' ? equipmentSnapshot(data).items : records(data, kind, spec.primary);
  } catch {
    throw new DirectorySaveError('The save was accepted, but fresh records could not be loaded. Refresh records to verify the result.', 'uncertain', id);
  }
  const record = items.find(row => row.id === id);
  if (!matchesPayload(record, payload)) {
    throw new DirectorySaveError('The save was accepted, but the fresh record does not match the submitted fields. Refresh records before making another change.', 'uncertain', id);
  }
  return { record, data };
}
export function searchRecords(items, query, fields) {
  const key = query.trim().toLowerCase();
  return key ? items.filter(row => fields.some(field => String(row[field] ?? '').toLowerCase().includes(key))) : items;
}
export function teamJobCount(member, jobs) {
  return jobs.filter(job => !['closed', 'cancelled', 'canceled', 'complete', 'completed'].includes(String(job.status || '').toLowerCase()) &&
    job.technicianUserId === member.userId).length;
}
