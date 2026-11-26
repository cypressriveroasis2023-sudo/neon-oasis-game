// Read-only record of the live function archives. It does not call the
// platform and it does not write a file.
// Pin refresh 2026-11-19: camera v16/47f904b7 became v17, and
// operations-pages v169/5a2b1c67 became v170.
// Pin refresh 2026-11-25: camera v17/6d64057b became v18 (troubleshoot-route-v17).
// Pin refresh 2026-11-25: camera v18/3c521a58 became v19 (camera-ports-v18).
// Pin refresh 2026-11-25: camera v19/c434eaf6 became v20 (a-links-v19).
// Pin refresh 2026-11-25: camera v20/a9cc477f became v21 (vcc-moves-v20).
// Pin refresh 2026-11-26: camera v21/ac4a0ff3 became v22 (morning-list-v21).
export const LIVE_FUNCTION_PINS = Object.freeze({
  'cos-unit-camera-status': Object.freeze({
    version: 22,
    ezbr_sha256: 'a306656ff5c1b4b0ab65f1e1c371204de0939538fbdbf55db1eb57b428be336f',
  }),
  'cos-operations-pages': Object.freeze({
    version: 170,
    ezbr_sha256: '69802c4effb4fcee77d2bfbe0e117356f3834e102ff98aa8e723e24f82b99c8e',
  }),
});

export function livePinsMatch(reported) {
  const camera = LIVE_FUNCTION_PINS['cos-unit-camera-status'];
  const pages = LIVE_FUNCTION_PINS['cos-operations-pages'];
  const problems = [];
  const cameraLive = reported?.['cos-unit-camera-status'];
  const pagesLive = reported?.['cos-operations-pages'];
  if (cameraLive?.version !== camera.version) problems.push('cos-unit-camera-status version');
  if (cameraLive?.ezbr_sha256 !== camera.ezbr_sha256) problems.push('cos-unit-camera-status archive');
  if (pagesLive?.version !== pages.version) problems.push('cos-operations-pages version');
  if (pagesLive?.ezbr_sha256 !== pages.ezbr_sha256) problems.push('cos-operations-pages archive');
  return problems;
}

const camera = LIVE_FUNCTION_PINS['cos-unit-camera-status'];
const pages = LIVE_FUNCTION_PINS['cos-operations-pages'];
console.log(`cos-unit-camera-status v${camera.version} archive ${camera.ezbr_sha256.slice(0, 8)}`);
console.log(`cos-operations-pages v${pages.version} archive ${pages.ezbr_sha256.slice(0, 8)}`);
console.log('Read-only pins. Nothing was requested and nothing was written.');
