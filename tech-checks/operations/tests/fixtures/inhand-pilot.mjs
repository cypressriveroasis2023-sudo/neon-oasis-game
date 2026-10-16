export const pilotDevice = { id: '111111111111111111111111', serialNumber: 'SYNTHETIC000001', name: 'Helios 001' };
export function pilotControl(state = 'ready') {
  return { source: 'inhand_pilot_control', version: 1, pilotId: 'helios001-20261006', device: { ...pilotDevice }, state, serverTime: '2026-10-06T16:00:00.000Z',
    armedAt: state === 'unarmed' ? null : '2026-10-06T15:55:00.000Z', expiresAt: state === 'unarmed' ? null : state === 'expired' ? '2026-10-06T15:59:59.000Z' : '2026-10-06T16:10:00.000Z', attemptedAt: state === 'consumed' ? '2026-10-06T15:58:00.000Z' : null };
}
export function pilotSnapshot() {
  return { source: 'inhand', version: 1, fetchedAt: '2026-10-06T16:00:01.000Z',
    identity: { deviceId: pilotDevice.id, serialNumber: pilotDevice.serialNumber, name: pilotDevice.name },
    connection: { reportedStatus: 'online', statusObservedAt: null, freshness: 'unknown', independentlyProbed: false },
    network: { publicIp: '192.0.2.44', wanIp: '10.0.0.8', infoUpdatedAt: '2026-10-06T12:50:44.000Z' },
    location: { latitude: 40, longitude: -100, source: 'cellTower', observedAt: '2026-09-29T01:16:05.000Z', freshness: 'stale', accuracyM: null, address: 'Synthetic tower location' },
    locationUnavailableReason: null, providerTimes: { infoUpdatedAt: '2026-10-06T12:50:44.000Z', profileUpdatedAt: null, logtime: null }, mapping: { status: 'not_mapped', cosUnitId: null } };
}
