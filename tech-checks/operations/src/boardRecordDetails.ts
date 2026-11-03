/** Presentation of the existing board contract. No readers, writes or unit matching. */
export type BoardDetailInput = { id: string; kind: 'job' | 'task'; record: unknown };
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Accept recorded instants only; never guess a timezone for a local date/string. */
export function boardSavedInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function boardRecordTime(value: unknown): string {
  const instant = boardSavedInstant(value);
  return instant ? new Date(instant).toLocaleString('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }) : 'Time not supplied';
}

/** Pin the source timestamp to the opened record, not to subsequent board refreshes. */
export function captureBoardSelection<T extends BoardDetailInput>(card: T, asOf: unknown): T & { detailAsOf: string | null } {
  return { ...card, detailAsOf: boardSavedInstant(asOf) };
}

function savedJobId(card: BoardDetailInput, record: RecordValue): string | null {
  if (card.id !== `${card.kind}:${record.id}`) return null;
  if (card.kind === 'task') return uuid(record.id) && uuid(record.relatedJobId) ? record.relatedJobId : null;
  if (card.kind !== 'job') return null;
  if (record.completionKind === 'visit') {
    // The installed board response supplies all three; do not parse/guess missing IDs.
    return uuid(record.jobId) && uuid(record.visitId) && record.id === `${record.jobId}:visit:${record.visitId}` ? record.jobId : null;
  }
  if (record.completionKind != null && record.completionKind !== '') return null;
  if (record.jobId != null && record.jobId !== record.id) return null;
  return uuid(record.id) ? record.id : null;
}

export function boardRecordDetail(card: BoardDetailInput) {
  const record = object(card.record) || {};
  const completedVisit = card.kind === 'job' && record.completionKind === 'visit';
  const department = text(record.assignedDepartment);
  const assigned = card.kind === 'job' ? text(record.technician) : text(record.assignedTo);
  const notesSource = card.kind === 'job' && Array.isArray(record.notes) ? record.notes : [];
  const notes = notesSource.flatMap((entry, index) => {
    const note = object(entry);
    if (!note || !text(note.text)) return [];
    return [{ key: index, text: text(note.text), author: text(note.by) || 'Author not supplied', at: boardSavedInstant(note.at) }];
  }).reverse(); // Existing job RPC orders notes oldest first. Keep source order, including undated notes.
  return {
    completedVisit,
    jobId: savedJobId(card, record),
    jobLinkLabel: card.kind === 'task' ? 'Open related job' : completedVisit ? 'Open current job' : 'Open job record',
    responsible: assigned || (card.kind === 'task' && department ? `${department.toUpperCase()} team` : 'Unassigned'),
    responsibleLabel: completedVisit ? 'Technician on completed visit' : 'Assigned to',
    jobType: card.kind === 'job' ? text(record.jobType) || null : null,
    equipment: card.kind === 'job' ? text(record.equipment) || null : null,
    equipmentTag: card.kind === 'job' ? text(record.equipmentUnitTag) || null : null,
    equipmentLabel: completedVisit ? 'Current job equipment tag — not visit evidence' : 'Recorded equipment tag',
    // The current response has a tag, not an authoritative unit ID. Ignore invented aliases.
    unitId: null,
    instructions: card.kind === 'task' ? text(record.instructions) || null : null,
    ownerNotes: card.kind === 'task' ? text(record.ownerNotes) || null : null,
    notes,
    notesUnavailable: card.kind === 'job' && !Array.isArray(record.notes),
    omittedNotes: notesSource.length - notes.length,
    historyLabel: completedVisit ? 'Saved job notes — not visit-specific' : 'Saved job notes',
    startedAt: card.kind === 'task' ? boardSavedInstant(record.startedAt) : null,
    completedAt: card.kind === 'task' || completedVisit ? boardSavedInstant(record.completedAt) : null,
  };
}
