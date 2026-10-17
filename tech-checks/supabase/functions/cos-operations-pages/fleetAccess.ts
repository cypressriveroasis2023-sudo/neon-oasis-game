// Only used after authenticate has validated the current legacy profile, exact
// same-person link, active native organization profile and matching native role.
export const ITTECH_LEGACY_ID='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
// A separately approved same-person native identity is required. Configuration
// cannot borrow an existing Owner or another technician's native account.
export function configuredIttechActor(value:unknown):string|null{
 return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)&&!new Set(['3f073784-96e7-43d8-b9e0-33ab31c3c8b1','d0757b64-9623-4adc-afff-21cc7853e88a','3caf7c00-627f-445f-bce4-ddeae574ee5c','7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8','1a7d3523-8a3c-488a-9216-4e37f4f7ecb9']).has(value)?value:null;
}
export function verifiedItFleet(context: any,ittechNativeActor:unknown=null): boolean {
  return context?.department === 'it' && context?.legacyOwner === false &&
    ((context.legacyId === '4f7044b5-86b6-411f-8898-39bb64b4ddbc' && context.actorId === 'd0757b64-9623-4adc-afff-21cc7853e88a') ||
     (context.legacyId === 'b7cc3cbf-d11e-4d4a-9742-c07701857911' && context.actorId === '3caf7c00-627f-445f-bce4-ddeae574ee5c') ||
     (context.legacyId===ITTECH_LEGACY_ID&&configuredIttechActor(ittechNativeActor)!==null&&context.actorId===configuredIttechActor(ittechNativeActor)));
}
export function fleetRouteAllowed(method: string, path: string): boolean {
  return method === 'GET' && (path === '/api/unit-tracker' || /^\/api\/unit-tracker\/(?:requests\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path))
    || method === 'POST' && (path === '/api/unit-tracker/requests'||path === '/api/mhelpdesk/partner/unit-location')
    || method === 'GET' && new Set([
    '/api/session', '/api/field-map', '/api/camera-health/summary',
    '/api/camera-health/summary-v2', '/api/camera-health/summary-v3', '/api/routers',
    // Saved, read-only installations only. /refresh and all discovery/sharing writes stay Owner-only.
    '/api/vrm-fleet',
  ]).has(path);
}
export function fleetFeatures() {
  return {unitTracker:true, fleetAccess:true, vrmRead:true, fleetPlacementEdit:true, fleetConnectionEdit:true,
    cameraHealthV2:true, fieldLocationVerification:false, mhelpTicketImport:false, deliveryGoBack:false};
}
