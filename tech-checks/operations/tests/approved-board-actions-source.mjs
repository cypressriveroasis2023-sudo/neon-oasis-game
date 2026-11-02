import assert from 'node:assert/strict';

/** Reverse only the declared import and action-wrapper tags. All child expressions must survive unchanged. */
export function originalBoardActionsMarkup(source) {
  assert.equal(source.split("import ApprovedBoardActions from './ApprovedBoardActions';").length,2);
  assert.equal(source.split('<ApprovedBoardActions>').length,2);
  assert.equal(source.split('</ApprovedBoardActions>').length,2);
  return source.replace("import ApprovedBoardActions from './ApprovedBoardActions';\n",'')
    .replace('<ApprovedBoardActions>',"<div className='daily-board-actions'>")
    .replace('</ApprovedBoardActions>','</div>');
}
