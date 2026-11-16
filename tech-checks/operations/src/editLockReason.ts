/**
 * Why editing is held back, said accurately.
 *
 * Three different problems used to share one message. Only one of them is
 * about who you are, so telling a technician who is IT that only IT may
 * change a unit sent them to find someone else for a fault that a refresh
 * would have cleared.
 */
export function editLockReason(report:{canEdit?:boolean;handEditsRead?:boolean}|null,uncertain:boolean):string{
 if(uncertain)return 'The last save could not be confirmed, so editing is held back until you refresh. Check the saved address before changing anything else.';
 if(report&&report.canEdit===true&&report.handEditsRead!==true)
  return 'The saved hand edits could not be read, so a new one cannot be recorded safely. Refresh and try again.';
 return 'Only you and IT can change a unit.';
}
