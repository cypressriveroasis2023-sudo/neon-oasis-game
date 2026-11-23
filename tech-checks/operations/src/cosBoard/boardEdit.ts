import type {HandEditField, UnitCameraStatus} from '../../shared/starUnitStatus';

/**
 * Hand fixes from the board screen.
 *
 * The board asks and Fleet sends, through the route Camera status already
 * uses. The server decides who may edit and keeps who made each fix and when.
 */

/** One hand fix the board asks for. A null value clears the fix that is in force. */
export type BoardFixStep = {field: HandEditField; value: string | null};
export type BoardEditFlags = {canEdit: boolean; handEditsRead: boolean};
export type BoardEditState = {can: boolean; why: string};

/**
 * Whether a hand fix may be made right now. It follows Camera status: the feed
 * must say this person may edit, the saved hand fixes must have been read, and
 * after a save that could not be confirmed nothing more is saved until the
 * person refreshes and sees what is there.
 */
export function boardEditState(flags: BoardEditFlags | null, locked: boolean): BoardEditState {
  if (locked) return {can: false, why: 'The last save could not be confirmed. Tap Refresh before making another fix.'};
  if (!flags) return {can: false, why: 'Checking whether hand fixes are available.'};
  if (!flags.handEditsRead) return {can: false, why: 'The saved hand fixes could not be read, so a new one cannot be made safely. Tap Refresh to try again.'};
  if (!flags.canEdit) return {can: false, why: 'Hand fixes are for the Owner and IT.'};
  return {can: true, why: ''};
}

/** The request Camera status sends for the same hand fix. An address edit names the revision it was made against. */
export function handFixRequest(unit: Pick<UnitCameraStatus, 'unit' | 'addressRevision'>, step: BoardFixStep, requestId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {unitKey: unit.unit, field: step.field, requestId};
  if (step.field === 'address') body.expectedAddressRevision = unit.addressRevision ?? null;
  if (step.value === null) body.action = 'clear'; else body.value = step.value;
  return body;
}
