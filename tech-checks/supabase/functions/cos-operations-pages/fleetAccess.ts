// Only used after authenticate has validated the current legacy profile, exact
// same-person link, active native organization profile and matching native role.
export function verifiedItFleet(context: any): boolean {
  return context?.department === 'it' && context?.legacyOwner === false &&
    ((context.legacyId === '4f7044b5-86b6-411f-8898-39bb64b4ddbc' && context.actorId === 'd0757b64-9623-4adc-afff-21cc7853e88a') ||
     (context.legacyId === 'b7cc3cbf-d11e-4d4a-9742-c07701857911' && context.actorId === '3caf7c00-627f-445f-bce4-ddeae574ee5c') ||
     (context.legacyId === '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf' && context.actorId === 'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'));
}
export function fleetRouteAllowed(method: string, path: string): boolean {
  return method === 'GET' && /^\/api\/fleet-saved-board\/history\/[a-f0-9-]{36}$/i.test(path) || method === 'GET' && (path === '/api/unit-tracker' || /^\/api\/unit-tracker\/(?:requests\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path))
    || method === 'POST' && (path === '/api/fleet-saved-board/refresh' || path === '/api/fleet-saved-board/produce' || path === '/api/unit-tracker/requests'||path === '/api/mhelpdesk/partner/unit-location')
    || method === 'GET' && new Set([
    '/api/fleet-map-source', '/api/fleet-saved-board', '/api/session', '/api/field-map', '/api/camera-health/summary',
    '/api/camera-health/summary-v2', '/api/camera-health/summary-v3', '/api/product-connections', '/api/routers',
    // Read-only unit camera status from the Star4Live feed. No write, no placement change.
    '/api/unit-camera-status',
    // Saved, read-only installations only. /refresh and all discovery/sharing writes stay Owner-only.
    '/api/vrm-fleet',
  ]).has(path);
}
export function fleetFeatures() {
  return { durableFleetBoard: false,unitTracker:true, fleetAccess:true, vrmRead:true, fleetPlacementEdit:true, fleetConnectionEdit:true,
    cameraHealthV2:true, fieldLocationVerification:false, mhelpTicketImport:false, deliveryGoBack:false};
}
