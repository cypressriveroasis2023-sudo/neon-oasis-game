import assert from 'node:assert/strict';
import {originalFleetConnectionReadSource} from './fleet-connection-read-source.mjs';

/** Reverse the exact reviewed connection-read patch, then the approved presentation
 * wrapper, retaining the original versioned full-file hash guard. */
export function originalFleetViewMarkup(source) {
 source=originalFleetConnectionReadSource('FleetDashboard.tsx',source);
 const added="import ApprovedFleetViews from './ApprovedFleetViews';\n";
 assert.equal(source.split(added).length-1,1,'exactly one presentation import');
 assert.equal(source.split('<ApprovedFleetViews compact>').length-1,1,'exactly one view wrapper');
 assert.equal(source.split('</ApprovedFleetViews>').length-1,1,'exactly one closing wrapper');
 return source.replace(added,'').replace('<ApprovedFleetViews compact>',"<nav className='cos-fleet-tabs' aria-label='Fleet dashboard views'>").replace('</ApprovedFleetViews>','</nav>');
}
