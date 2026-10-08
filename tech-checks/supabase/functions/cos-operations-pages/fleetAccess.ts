// Only used after authenticate has validated the current legacy profile, exact
// same-person link, active native organization profile and matching native role.
export function verifiedItFleet(context: any): boolean {
  return context?.department === 'it' && context?.legacyOwner === false &&
    ((context.legacyId === '4f7044b5-86b6-411f-8898-39bb64b4ddbc' && context.actorId === 'd0757b64-9623-4adc-afff-21cc7853e88a') ||
     (context.legacyId === 'b7cc3cbf-d11e-4d4a-9742-c07701857911' && context.actorId === '3caf7c00-627f-445f-bce4-ddeae574ee5c'));
}
export function fleetRouteAllowed(method: string, path: string): boolean {
  return method === 'GET' && new Set([
    '/api/session', '/api/field-map', '/api/camera-health/summary',
    '/api/camera-health/summary-v2', '/api/camera-health/summary-v3', '/api/routers',
  ]).has(path);
}
export function fleetFeatures() {
  return {fleetAccess:true, fleetPlacementEdit:true, fleetConnectionEdit:true,
    cameraHealthV2:true, fieldLocationVerification:false, mhelpTicketImport:false, deliveryGoBack:false};
}
