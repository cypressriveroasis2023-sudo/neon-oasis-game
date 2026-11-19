// Read-only record of the live function archives this pull request was checked
// against. It does not call the platform and it does not write a file.
export const LIVE_FUNCTION_PINS = Object.freeze({
  'cos-unit-camera-status': Object.freeze({
    version: 16,
    ezbr_sha256: '47f904b7621e97c336d76b0ee7beb1d696fecda6a2f42deed8500dab837d3883',
  }),
  'cos-operations-pages': Object.freeze({
    ezbr_sha256_prefix: '5a2b1c67',
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
  if (!String(pagesLive?.ezbr_sha256 || '').startsWith(pages.ezbr_sha256_prefix)) problems.push('cos-operations-pages archive');
  return problems;
}

const camera = LIVE_FUNCTION_PINS['cos-unit-camera-status'];
const pages = LIVE_FUNCTION_PINS['cos-operations-pages'];
console.log(`cos-unit-camera-status v${camera.version} archive ${camera.ezbr_sha256.slice(0, 8)}`);
console.log(`cos-operations-pages archive prefix ${pages.ezbr_sha256_prefix}`);
console.log('Read-only pins. Nothing was requested and nothing was written.');
