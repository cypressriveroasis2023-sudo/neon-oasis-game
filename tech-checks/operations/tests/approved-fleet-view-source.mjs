import assert from 'node:assert/strict';

/** Reverse only the approved presentation wrapper, retaining the original full-file hash guard. */
export function originalFleetViewMarkup(source) {
 const added="import ApprovedFleetViews from './ApprovedFleetViews';\n";
 assert.equal(source.split(added).length-1,1,'exactly one presentation import');
 assert.equal(source.split('<ApprovedFleetViews compact={ownerManagementEnabled}>').length-1,1,'exactly one view wrapper');
 assert.equal(source.split('</ApprovedFleetViews>').length-1,1,'exactly one closing wrapper');
 return source.replace(added,'').replace('<ApprovedFleetViews compact={ownerManagementEnabled}>',"<nav className='cos-fleet-tabs' aria-label='Fleet dashboard views'>").replace('</ApprovedFleetViews>','</nav>');
}
