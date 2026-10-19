import {withMhelpAddressMap} from './mhelpAddressMap.ts';
import {validatedLocationProofs} from './validatedLocationProofs.ts';
import {projectMhelpFleetLocations} from './mhelpFleetLocationProjection.ts';
import {projectEffectiveFleetPlacement} from './effectiveFleetPlacement.ts';
import {projectMhelpUploadPlacement} from './mhelpUploadPlacement.ts';
import {EQUIPMENT_CSV_MAX_BYTES} from './mhelpEquipmentCsvPreview.ts';
import {ownerEquipmentCsvReview} from './mhelpEquipmentOwnerReview.ts';
import {stageOwnerEquipmentCsv,commitOwnerEquipmentCsv} from './mhelpEquipmentWriteBridge.ts';
import {projectCurrentTrackerPlacement,projectCombinedFleetRoster} from './combinedFleetRoster.ts';
import {sourceEquipmentAddressCandidates,projectSourceEquipmentAddressEstimates} from './sourceEquipmentAddressEstimates.ts';
import { checkedTvSections } from './tv-board-settings/index.ts';
import {createMhelpIntakeReviewBridge,MhelpIntakeReviewError} from './mhelpIntakeReviewBridge.ts';
import {projectMhelpFieldPlacement,projectMhelpCameraPlacement} from './mhelpPlacementProjection.ts';
import {createLegacyInstallEvidenceReader,legacyEvidenceTransport,LegacyInstallEvidenceError} from './legacyInstallEvidence.ts';
import {createUnitTracker,UnitTrackerError} from './unitTracker.ts';
import {createOperationalMoves,OperationalMoveError} from './operationalMoves.ts';
import {createSheetsConnection,SheetsConnectionError} from './googleSheets.ts';
import {createMhelpPartnerHandler,MhelpPartnerError} from './mhelpPartner.ts';
import {createMhelpUnitLocationReader} from './mhelpUnitLocation.ts';
import {createMhelpTicketReader,projectMhelpTicketPreview,MhelpTicketError} from './mhelpTickets.ts';
import {MHELP_TICKET_PRIVATE_SAMPLE,validateMhelpPrivateSampleRequest,projectMhelpPrivateSample} from './mhelpTicketPrivateSample.ts';
import {mhelpTodayPreviewWindow,mhelpPreviousDayPreviewWindow} from './mhelpTicketDay.ts';
import {mhelpTicketDiagnostic} from './mhelpTicketDiagnostics.ts';
import {nativeMhelpTokens} from './mhelpTokenRuntime.ts';
import {MhelpReconnectError} from './mhelpReconnect.ts';
import {readSourceRecordedCoordinates,projectSourceRecordedCoordinates} from './sourceRecordedCoordinates.ts';
import {projectArchivedRepresentations,projectArchivedEquipmentRegistry} from './archivedRepresentationProjection.ts';
import { projectFallbackGeocodes } from './fallbackGeocodeProjection.ts';
// Keep the verified production reader until the V3 database rollout passes its live map check.
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding} from './importedSourceProjectionV2.ts';
import {verifiedItFleet, fleetRouteAllowed, fleetFeatures} from './fleetAccess.ts';
import { projectReviewedAddressEstimates } from './reviewedAddressEstimates.ts';
import { projectFieldGeocodes } from './fieldGeocodeProjection.ts';
import {OWNER_CENSUS_NATIVE_FIELDS,OWNER_CENSUS_SITE_FIELDS,readOwnerCensusEvidence,readOwnerCensusPreparation,readOwnerCensusJson,matchesOwnerCensusProof} from './ownerCensusProof.ts';
import { projectOwnerPlacement, projectCameraOwnerPlacement, placementMatchKey } from './placementProjection.ts';
import { withDeliveryGoBacks } from './deliveryGoBack.ts';
import { createMhelpImportHandler, readMhelpAwareJson, readMhelpAwareJsonWithSize, MHELP_JSON_LIMIT, MhelpImportError } from './mhelpImport.ts';
import { cameraSummary } from './cameraEvidence.ts';
import { cameraSummary as placementCameraSummary } from './cameraPlacementEvidence.ts';
import {currentTrackerShopScope} from './cameraTrackerShopScope.ts';
import {createOwnerIdentityReview} from './ownerIdentityReview.ts';
import {OwnerIdentityError,validateOwnerIdentitySnapshot} from './ownerIdentityCrosswalk.ts';
import { verifiedHealthIdentities } from './verifiedHealthIdentity.ts';
import {fieldRecorderHealthGuards,projectFieldRecorderAuthority} from './fieldRecorderObservation.ts';
import {projectReconProviderIdentities,appendReconProviderIdentities} from './reconProviderIdentity.ts';
import { routerSnapshot } from './routers.ts';
import { createInhandPilotReader, InhandPilotError, readPilotClaimBoolean } from './inhandPilot.ts';
import { vrmPortalConfig } from './vrm.ts';
import { createVrmFleetReader } from './vrmDiscovery.ts';
import { createPrivateEvidenceReader, PrivateEvidenceError } from './privateEvidence.ts';
// COS Operations bridge: existing GitHub Tech Check identity -> same-person production Owner or scoped technician access.
// No browser-supplied actor, organization, table, RPC name, service key, or identity provisioning.
const LEGACY_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const ORGANIZATION_ID = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OWNER_LINKS = Object.freeze({
  'e4abc521-1ef3-45a6-9829-b87faff78210': '3f073784-96e7-43d8-b9e0-33ab31c3c8b1',
});
// Explicit existing same-person technician pairs; never match accounts by mutable contact email.
const TECHNICIAN_LINKS = Object.freeze({
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc': { actorId: 'd0757b64-9623-4adc-afff-21cc7853e88a', name: 'Teddy Hopper', department: 'it', roleCode: 'it_technician' },
  'b7cc3cbf-d11e-4d4a-9742-c07701857911': { actorId: '3caf7c00-627f-445f-bce4-ddeae574ee5c', name: 'Victor Garcia', department: 'it', roleCode: 'it_technician' },
  '78e54fbd-c2db-4d18-8e3d-a9740adcf285': { actorId: '7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', name: 'Abel Cervantes', department: 'service', roleCode: 'service_technician' },
  '49dce28e-099a-40bb-a8d8-b39f9ffbabee': { actorId: '1a7d3523-8a3c-488a-9216-4e37f4f7ecb9', name: 'Josh Mireles', department: 'service', roleCode: 'service_technician' },
});
const ALLOWED_ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new HttpError(message, status); };
function textValue(value, label, required = false, max = 4000) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') fail(label + ' must be text.');
  const result = value.trim();
  if (required && !result) fail(label + ' is required.');
  if (result.length > max) fail(label + ' is too long.');
  return result || null;
}
function allowedFields(body, fields, label = 'Request') {
  const allowed = new Set(fields);
  if (Object.keys(body).some(key => !allowed.has(key))) fail(label + ' contains unsupported fields.');
}
function enumValue(value, label, allowed, fallback) {
  const result = textValue(value, label) || fallback;
  if (!allowed.includes(result)) fail('Choose a valid ' + label.toLowerCase() + '.');
  return result;
}
function idValue(value, label, required = true) {
  if (!required && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail(label + ' must be a valid identifier.');
  return value.toLowerCase();
}
function localTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, yy, mm, dd, hh, mi] = match;
  const y = Number(yy), m = Number(mm), d = Number(dd), h = Number(hh), i = Number(mi);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || i > 59) return null;
  return yy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi;
}
function schedule(body, optional = false) {
  const absent = v => v == null || (typeof v === 'string' && !v.trim());
  if (optional && absent(body.start) && absent(body.end)) return { start: null, end: null };
  const start = localTime(body.start), end = localTime(body.end);
  if (!start || !end) fail('Enter valid start and end dates in YYYY-MM-DD HH:MM format.');
  if (end <= start) fail('End time must be after start time.');
  return { start, end };
}
async function requestBody(request) {
  return readMhelpAwareJson(request, 65536);
}

function gps(body) {
  const allowed = new Set(['latitude', 'longitude', 'accuracyM', 'source', 'note']);
  if (Object.keys(body).some(k => !allowed.has(k))) fail('GPS request contains unsupported fields.');
  const finite = (v, label) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(label + ' is required and must be a finite number.');
    return v;
  };
  const latitude = finite(body.latitude, 'Latitude'), longitude = finite(body.longitude, 'Longitude');
  if (latitude < -90 || latitude > 90) fail('Latitude must be between -90 and 90.');
  if (longitude < -180 || longitude > 180) fail('Longitude must be between -180 and 180.');
  const accuracyM = body.accuracyM == null ? null : finite(body.accuracyM, 'GPS accuracy');
  if (accuracyM !== null && accuracyM < 0) fail('GPS accuracy must be zero or greater.');
  const source = (textValue(body.source, 'GPS source') || 'manual').toLowerCase();
  if (!['manual', 'device_gps', 'phone_gps', 'site', 'router', 'import'].includes(source)) fail('Unsupported GPS source.');
  return { latitude, longitude, accuracyM, source, note: textValue(body.note, 'GPS note') };
}

/** Dependencies can be injected for meaningful authentication/contract regression tests. */
export function createOperationsHandler(options) {
  const requestFetch = options.fetch || fetch;
  const serviceKey = options.serviceKey;
  const platformUrl = options.platformUrl;
  const readJson = async (url, init, fallback) => {
    let response;
    try { response = await requestFetch(url, init); }
    catch { fail(fallback, 503); }
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      if (/\/rest\/v1\/rpc\/cos_unit_tracker_/.test(url)) {
        if (data.code === '42501') fail('An active COS Owner or verified IT account is required.',403);
        if (['55000','PGRST202','42883'].includes(data.code)) fail('Pending tracker requests are not enabled on this backend. Sheets connection required.',503);
        if (data.code === '23505') fail('This exact unit already has a pending tracker request. Refresh to review it.',409);
        if (['55P03','40001','40P01'].includes(data.code)) fail(typeof data.message === 'string' ? data.message : 'A tracker request or source changed. Reload before saving.',409);
        if (data.code === '22023') fail(typeof data.message === 'string' ? data.message : 'Invalid tracker request.',400);
      }

      if (url.endsWith('/rest/v1/rpc/appdeploy_request_delivery_go_back') && ['55P03','40001','40P01'].includes(data.code)) fail('This delivery is being updated. Refresh the job before trying again.', 409);
      if (url.endsWith('/rest/v1/rpc/appdeploy_mhelp_import') && data.code === '40001') fail(typeof data.message === 'string' ? data.message : 'Another mHelpDesk import is in progress. Review import history before retrying.', 409);
      if (response.status >= 500) fail(fallback, 503);
      const message = typeof data.message === 'string' ? data.message : fallback;
      fail(message, response.status === 401 || response.status === 403 ? response.status : 409);
    }
    return data;
  };
  const platformHeaders = () => ({
    apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
    Accept: 'application/json', 'Content-Type': 'application/json',
  });
  const platformRead = (path, signal = undefined) => readJson(platformUrl + '/rest/v1/' + path, {
    headers: platformHeaders(), ...(signal ? {signal} : {}),
  }, 'COS production data is unavailable. Please retry.');
  const readPrivateOwnerEvidence = createPrivateEvidenceReader({
    organizationId: ORGANIZATION_ID,
    read: platformRead,
    readObject: (bucket, path, signal) => requestFetch(platformUrl + '/storage/v1/object/authenticated/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'), {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      redirect: 'error', cache: 'no-store', signal,
    }),
  });
  const platformAll = async (path, signal = undefined) => {
    const items = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const page = await platformRead(path + '&limit=1000&offset=' + offset, signal);
      if (!Array.isArray(page)) fail('COS production returned an invalid collection.', 503);
      items.push(...page);
      if (page.length < 1000) return items;
    }
    fail('COS production collection exceeds the supported page limit.', 503);
  };
  const rpc = (name, payload, signal = undefined) => readJson(platformUrl + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: platformHeaders(), body: JSON.stringify(payload), ...(signal ? {signal} : {}),
  }, 'COS workflow could not be completed. Please retry.');
  const readMhelpPlacements=async(actorPayload,signal=undefined)=>{if(options.mhelpPlacementEnabled!==true)return null;const receipt=await rpc('cos_mhelp_placement_snapshot',actorPayload,signal);try{return {...receipt,fleetLocations:await rpc('cos_mhelp_location_snapshot',actorPayload,signal)};}catch{return receipt;}};
  // Camera placement consumes only guarded status/items; full map and roster readers stay unchanged.
  const readMhelpCameraPlacements=async(actorPayload,signal=undefined)=>{if(options.mhelpPlacementEnabled!==true)return null;const receipt=await rpc('cos_mhelp_placement_snapshot',{...actorPayload,p_projection:'camera'},signal);if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw Error('Invalid placement receipt');return receipt;};
  const readVrmFleet = options.vrm ? createVrmFleetReader({ fetch: requestFetch, rpc, embeds: options.vrmEmbeds, getAccessToken: options.vrm.getAccessToken }) : null;
  const mhelpImport = createMhelpImportHandler({ rpc, organizationId: ORGANIZATION_ID });
  const sheetsConnection=createSheetsConnection({fetch:requestFetch,getServiceAccountJson:options.googleSheets?.getServiceAccountJson||(()=>undefined),signAssertion:options.googleSheets?.signAssertion});
  const mhelpPartner = createMhelpPartnerHandler({
    fetch: requestFetch,
    getConfig: options.mhelpPartner?.getConfig || (() => ({})),
    renewAccess: options.mhelpPartner?.renewAccess,
    readNativeUnits: () => platformAll('equipment_units?select=id,unit_number,metadata&organization_id=eq.' + ORGANIZATION_ID + '&order=id.asc'),
  });
  const readMhelpIntakeReview=createMhelpIntakeReviewBridge(requestFetch);
  const mhelpTickets=createMhelpTicketReader({fetch:requestFetch,getConfig:options.mhelpPartner?.getConfig || (()=>({})),renewAccess:options.mhelpPartner?.renewAccess});
  const mhelpUnitLocation=createMhelpUnitLocationReader({fetch:requestFetch,getConfig:options.mhelpPartner?.getConfig || (()=>({})),renewAccess:options.mhelpPartner?.renewAccess});
  // This isolated control RPC is claimed once before the provider secret can be read.
  const readInhandPilot = createInhandPilotReader({
    ...options.inhandPilot,
    fetch: requestFetch,
    claimAttempt: async actorId => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const attemptId = crypto.randomUUID(); // Correlation only, never a credential or caller authorization.
      const payload = { p_actor_user_id: actorId, p_attempt_id: attemptId };
      const control = async name => readPilotClaimBoolean(await requestFetch(platformUrl + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { ...platformHeaders(), Prefer: 'tx=commit' }, body: JSON.stringify(payload),
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      }), controller.signal);
      try {
        if (!await control('cos_claim_inhand_pilot')) return false;
        // Separate transaction readback; a rolled-back claim or mismatched attempt cannot use the token.
        if (!await control('cos_verify_inhand_pilot_claim')) throw new Error('Pilot claim not durable.');
        return true;
      } finally { clearTimeout(timer); controller.abort(); }
    },
  });

  const authenticate = async request => {
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) fail('Sign in to Tech Check to continue.', 401);
    const headers = { apikey: LEGACY_PUBLISHABLE_KEY, Authorization: authorization, Accept: 'application/json' };
    let user;
    try { user = await readJson(LEGACY_URL + '/auth/v1/user', { headers }, 'Your sign-in could not be verified.'); }
    catch (cause) {
      if (cause.status === 503) throw cause;
      fail('Your sign-in has expired. Sign in again.', 401);
    }
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) fail('A verified Tech Check account is required.', 401);
    const profiles = await readJson(LEGACY_URL + '/rest/v1/profiles?select=user_id,full_name,role,active,archived_at&user_id=eq.' + user.id + '&limit=1', { headers }, 'Tech Check account access could not be verified.');
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || profile.user_id !== user.id || !['owner', 'it', 'service'].includes(profile.role) || profile.active !== true || profile.archived_at) fail('An active COS account is required.', 403);
    const technicianLink = TECHNICIAN_LINKS[user.id.toLowerCase()];
    const legacyOwner = profile.role === 'owner';
    const link = legacyOwner ? null : technicianLink;
    const actorId = legacyOwner ? OWNER_LINKS[user.id.toLowerCase()] : link?.actorId;
    const context = { legacyId: user.id, name: profile.full_name || (legacyOwner ? 'Owner' : 'Technician'), department: profile.role, legacyOwner, authorization, headers, actorId };
    if (!actorId) return context;
    if (link && (profile.role !== link.department || String(profile.full_name || '').trim().toLowerCase() !== link.name.toLowerCase())) fail('Your linked technician identity details have changed. Ask an Owner to review the link.', 403);
    if (!serviceKey || !platformUrl) fail('The COS production connection is not configured.', 503);
    const actors = await platformRead('user_profiles?select=user_id,display_name,active,department&organization_id=eq.' + ORGANIZATION_ID + '&user_id=eq.' + actorId + '&limit=1');
    const actor = Array.isArray(actors) ? actors[0] : null;
    const expectedDepartment = legacyOwner ? 'owner' : link.department;
    if (!actor || actor.user_id !== actorId || actor.active !== true || actor.department !== expectedDepartment) fail('Your linked COS production account is inactive or has a different department.', 403);
    if (link && String(actor.display_name || '').trim().toLowerCase() !== link.name.toLowerCase()) fail('Your linked production technician identity details have changed.', 403);
    const roleCode = legacyOwner ? 'owner' : link.roleCode;
    const roles = await platformRead('user_roles?select=role_id,roles!inner(code,organization_id)&user_id=eq.' + actorId + '&roles.organization_id=eq.' + ORGANIZATION_ID + '&roles.code=eq.' + roleCode + '&limit=1');
    if (!Array.isArray(roles) || !roles.some(row => row.roles?.code === roleCode && row.roles?.organization_id === ORGANIZATION_ID)) fail('Your linked COS production role is not active.', 403);
    return {...context,ownerRoleId:legacyOwner?roles.find(row=>row.roles?.code==='owner'&&row.roles?.organization_id===ORGANIZATION_ID)?.role_id:null};
  };
  const fleetPlacementAudits = async (context, signal = undefined) => {
    const rows=[]; let cursor=null;
    for(let page=0;page<200;page++) {
      const result=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_fleet_placement_evidence_v1', {
        method:'POST', headers:{...context.headers,'Content-Type':'application/json'},
        body:JSON.stringify({p_before_id:cursor,p_limit:500}), ...(signal ? {signal} : {}),
      },'Fleet placement evidence is unavailable.');
      if(!Array.isArray(result)||result.length>500)fail('Fleet placement page is invalid.',503);
      let previous=cursor;
      for(const row of result){
        const id=String(row?.id||'');
        if(!/^[1-9][0-9]{0,18}$/.test(id)||BigInt(id)>9223372036854775807n||(previous!==null&&BigInt(id)>=BigInt(previous)))fail('Fleet placement page order is invalid.',503);
        previous=id;
      }
      rows.push(...result);
      if(result.length<500)return rows;
      cursor=previous;
    }
    fail('Fleet placement evidence exceeds the safe page limit.',503);
  };
  const assertRecord = async (table, id, fields = 'id') => {
    const records = await platformRead(table + '?select=' + fields + '&organization_id=eq.' + ORGANIZATION_ID + '&id=eq.' + id + '&limit=1');
    if (!Array.isArray(records) || !records.length) fail('COS record not found.', 404);
    return records[0];
  };
  const legacyAll = async (path, headers, signal = undefined) => {
    const items = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const rows = await readJson(LEGACY_URL + '/rest/v1/' + path + '&limit=1000&offset=' + offset, { headers, ...(signal ? {signal} : {}) }, 'Camera Health could not be loaded.');
      if (!Array.isArray(rows)) fail('Camera Health returned an invalid collection.', 503);
      items.push(...rows);
      if (rows.length < 1000) return items;
    }
    fail('Camera Health collection exceeds the supported page limit.', 503);
  };
  // Same existing bridge authorization; private claim evidence/serials never enter DTOs.
  const readIdentitySources = async (context, reviewKey = null, signal = undefined) => {
    const actorPayload={p_actor_user_id:context.actorId,p_organization_id:ORGANIZATION_ID};
    const crosswalk=await rpc('cos_owner_identity_snapshot',actorPayload,signal);
    validateOwnerIdentitySnapshot(crosswalk);
    const keys=[...new Set([...crosswalk.claims.map(c=>c.legacy_unit_key),...(reviewKey?[reviewKey]:[])])].sort();
    const readEpochs=async()=>{
      if(!keys.length)return [];
      return readJson(LEGACY_URL+'/rest/v1/rpc/cos_camera_identity_epochs_v1',{
        method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_unit_keys:keys}), ...(signal ? {signal} : {}),
      },'Camera identity incarnations are unavailable.');
    };
    const before=await readEpochs();
    const [devices,units,matches,providers,audits]=await Promise.all([
      legacyAll('camera_devices?select=id,external_device_id,device_serial,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,source_status,source_last_seen_at,last_online_at,last_probe_online_at,activation_state,recon_battery_percent:source_metadata->battery_percent,recon_battery_updated_at:source_metadata->>battery_updated_at,recon_battery_status:source_metadata->>battery_status,recon_battery_status_updated_at:source_metadata->>battery_status_updated_at&order=id.asc',context.headers,signal),
      platformAll('equipment_units?select=id,organization_id,unit_number,status&organization_id=eq.'+ORGANIZATION_ID+'&order=id.asc',signal),
      platformAll('vision_vigilant_unit_matches?select=id,organization_id,equipment_unit_id,vigilant_device_id,camera_key,match_method,confidence&organization_id=eq.'+ORGANIZATION_ID+'&order=id.asc',signal),
      platformAll('vision_vigilant_devices?select=id,organization_id,external_device_id,device_name,device_type,source&organization_id=eq.'+ORGANIZATION_ID+'&order=id.asc',signal),
      fleetPlacementAudits(context,signal),
    ]);
    const [after,current]=await Promise.all([readEpochs(),rpc('cos_owner_identity_snapshot',actorPayload,signal)]);
    validateOwnerIdentitySnapshot(current);
    if(crosswalk.revision!==current.revision)fail('Owner identity commitments changed while loading. Reload.',409);
    // Any bracketing change denies all affected proofs. Missing source data does
    // not become a name match; append-only commitments remain in the envelope.
    const epochs=JSON.stringify(before)===JSON.stringify(after)?after:[];
    const sources={units,matches,providers,devices,audits,ownerCrosswalk:crosswalk,ownerEpochs:epochs};
    return {sources,identity:await verifiedHealthIdentities(sources),reviewSources:{units,matches,providers,devices,epochs,crosswalk}};
  };
  // The same exact read and actor predicate serve execution and shared admission.
  const readOwnerCensusTarget=async(context,key,id,signal=undefined)=>{
    const bounded=async(url,init)=>readOwnerCensusJson(await requestFetch(url,{...init,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)}));
    const history=await bounded(platformUrl+'/rest/v1/rpc/appdeploy_unit_location_history',{
      method:'POST',headers:platformHeaders(),body:JSON.stringify({p_actor_user_id:context.actorId,p_unit_id:id}),
    });
    const native=await bounded(platformUrl+'/rest/v1/equipment_units?select='+OWNER_CENSUS_NATIVE_FIELDS.join(',')+'&organization_id=eq.'+ORGANIZATION_ID+'&id=eq.'+id+'&limit=2',{headers:platformHeaders()});
    if(!Array.isArray(native)||native.length!==1)throw Error('Exact native authority unavailable');
    let site=null;
    if(native[0].installed_site_id!==null){
      const siteId=idValue(native[0].installed_site_id,'Installed site');
      const sites=await bounded(platformUrl+'/rest/v1/sites?select='+OWNER_CENSUS_SITE_FIELDS.join(',')+'&organization_id=eq.'+ORGANIZATION_ID+'&id=eq.'+siteId+'&limit=2',{headers:platformHeaders()});
      if(!Array.isArray(sites)||sites.length!==1)throw Error('Exact native site unavailable');site=sites[0];
    }
    if(typeof key!=='string')throw Error('Exact camera epoch unavailable');
    const epochs=await bounded(LEGACY_URL+'/rest/v1/rpc/cos_camera_identity_epochs_v1',{
      method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_unit_keys:[key]}),
    });
    return {native:native[0],history,epochs,site};
  };
  /** Read-only execution evidence. Keep full identity/collision rosters while
   * avoiding unrelated provider result hydration. Never accepts actor/source keys. */
  const readOwnerCensusEnvelope=async(context,nativeId,binding,requestSignal,prepare,deadlineMs)=>{
    // Successful proof time includes authentication and envelope decoding, not a new budget after them.
    const remaining=deadlineMs-Date.now();
    if(remaining<=0)fail('Current Owner source proof deadline elapsed.',503);
    const signal=AbortSignal.any([requestSignal,AbortSignal.timeout(remaining)]);
    const checkDeadline=()=>{if(signal.aborted||Date.now()>=deadlineMs)fail('Current Owner source proof deadline elapsed.',503);};
    const actorPayload={p_actor_user_id:context.actorId,p_organization_id:ORGANIZATION_ID};
    const readArchives=async()=>{
      const rows=await rpc('cos_archived_representation_projection',{p_organization_id:ORGANIZATION_ID},signal);
      if(!Array.isArray(rows)||rows.length>50)fail('Current archive evidence is unavailable.',503);return rows;
    };
    const readSources=async(snapshot,archives)=>{
      // All archive endpoints are retained so final archive validation sees the
      // same imported protection state. Full raw inventory is never filtered.
      const ids=new Set([nativeId,...archives.flatMap(a=>[a.archivedNativeId,a.canonicalNativeId,a.archivedTrackerId,a.canonicalTrackerId])]);
      const identities=snapshot.inventoryItems.filter(r=>ids.has(r.id)).map(r=>({entityKind:r.readOnly===true?'tracker':'equipment_unit',nativeUnitId:r.id}));
      const rows=[];
      for(let offset=0;offset<identities.length;offset+=250){
        const batch=identities.slice(offset,offset+250),page=await rpc('cos_geocode_sources_map_projection',{p_organization_id:ORGANIZATION_ID,p_identities:batch},signal);
        if(!Array.isArray(page)||page.length>batch.length)fail('Current target source evidence is unavailable.',503);rows.push(...page);
      }
      return rows;
    };
    const readPrecedence=async(sources)=>{
      const bindings=(await Promise.all(sources.filter(s=>s?.sourcePrecedence!==undefined).map(checkedImportedBinding))).filter(Boolean);
      if(!bindings.length)return [];
      const confirmed=[];
      for(let offset=0;offset<bindings.length;offset+=250){
        const batch=bindings.slice(offset,offset+250),rows=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_imported_precedence_read_current',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_bindings:batch}),signal},'Reviewed source precedence is unavailable.');
        if(!Array.isArray(rows)||rows.length>batch.length)fail('Reviewed source precedence is unavailable.',503);
        confirmed.push(...(await Promise.all(rows.map(checkedImportedBinding))).filter(Boolean));
      }
      return confirmed;
    };
    const [initialSnapshot,initialBundle,initialArchives,records]=await Promise.all([
      rpc('appdeploy_field_map_snapshot',actorPayload,signal),readIdentitySources(context,null,signal),readArchives(),
      readJson(LEGACY_URL+'/rest/v1/rpc/cos_field_geocode_read_many',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_audit_ids:[binding.auditId]}),signal},'Saved target lookup is unavailable.'),
    ]);
    checkDeadline();
    if(!Array.isArray(records)||records.length!==1)fail('The enrolled Owner lookup is unavailable.',409);
    const record=records[0];
    if(record?.auditId!==binding.auditId||record.unitKey!==binding.unitKey||record.addressSha256!==binding.addressSha256)fail('The exact Owner lookup binding changed.',409);
    if(prepare){
      const marker=record.censusPreparation;
      if(record.status!=='invalid_address'||record.censusOnly===true||Object.hasOwn(record,'censusOnlyGuard')||Object.hasOwn(record,'censusOnlyState')
        ||!marker||typeof marker!=='object'||Array.isArray(marker)||Object.keys(marker).length!==1||marker.nativeUnitId!==nativeId)fail('Current Owner preparation authorization is unavailable.',409);
    }else if(record.censusOnly!==true||!['draining','ready','consumed'].includes(record.censusOnlyState)||record.censusOnlyGuard?.nativeUnitId!==nativeId||record.censusOnlyGuard?.nativeGuardSha256!==binding.nativeGuardSha256)fail('The enrolled Owner lookup binding changed.',409);
    const initialSources=await readSources(initialSnapshot,initialArchives);
    const initialContext={nativeUnits:initialBundle.sources.units,identity:initialBundle.identity,archivedRepresentations:initialArchives,confirmedPrecedenceBindings:await readPrecedence(initialSources)};
    const initial=await projectOwnerPlacement(await projectImportedSourceAddresses(initialSnapshot,initialSources,initialBundle.sources.audits,initialBundle.sources.devices,[],initialContext),initialBundle.sources.audits,initialBundle.sources.devices,initialBundle.identity,initialBundle.sources.units);
    if(!initial.items.some(r=>r.id===nativeId&&r.placementSource==='owner'&&r.placementAuditId===binding.auditId))fail('Current Owner placement is unavailable.',409);
    const [rawSnapshot,bundle,archives,mhelpReceipt]=await Promise.all([rpc('appdeploy_field_map_snapshot',actorPayload,signal),readIdentitySources(context,null,signal),readArchives(),readMhelpPlacements(actorPayload,signal)]);
    const sources=await readSources(rawSnapshot,[...initialArchives,...archives]);
    const archiveContext={nativeUnits:bundle.sources.units,identity:bundle.identity,archivedRepresentations:archives,previousArchivedRepresentations:initialArchives};
    const sourceContext={...archiveContext,currentSources:sources,confirmedPrecedenceBindings:await readPrecedence(sources)};
    const base=await projectOwnerPlacement(await projectImportedSourceAddresses(rawSnapshot,sources,bundle.sources.audits,bundle.sources.devices,initialSources,sourceContext),bundle.sources.audits,bundle.sources.devices,bundle.identity,bundle.sources.units);
    const inputs={actorId:context.actorId,rawSnapshot,snapshot:base,bundle,mhelpReceipt,readTarget:id=>readOwnerCensusTarget(context,binding.unitKey,id,signal)};
    const preparation=prepare?await readOwnerCensusPreparation({...inputs,binding:{nativeUnitId:nativeId,auditId:binding.auditId,unitKey:binding.unitKey,addressSha256:binding.addressSha256}}):null;
    const evidence=prepare?null:await readOwnerCensusEvidence({...inputs,records},true);
    const final=projectMhelpFieldPlacement(projectArchivedRepresentations(base,archives,bundle.sources.audits,bundle.sources.devices,archiveContext),mhelpReceipt,bundle.sources.audits,bundle.identity);
    checkDeadline();
    const aliases=final.nativePlacementAliases.filter(a=>a.unitId===nativeId),items=final.items.filter(r=>r.id===nativeId),inventory=final.inventoryItems.filter(r=>r.id===nativeId);
    if(signal.aborted||aliases.length!==1||items.length!==1||inventory.length!==1
      ||[items[0],inventory[0]].some(r=>r.placementSource!=='owner'||r.placement!=='FIELD'||r.status!=='field'||r.currentLocationType!=='field'||r.placementStatus==='needs_identity_review'||r.locationVerification==='owner_verified'))fail('Current complete Owner source proof is unavailable.',409);
    if(prepare){
      if(!preparation)fail('Current complete Owner preparation proof is unavailable.',409);
      // A separate preparation marker never substitutes for an enrolled policy.
      // Re-read its exact SQL before-image after source reads, without changing it.
      const latest=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_field_geocode_read_many',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_audit_ids:[binding.auditId]}),signal},'Current preparation authorization is unavailable.');
      checkDeadline();
      if(!Array.isArray(latest)||latest.length!==1||JSON.stringify(latest[0])!==JSON.stringify(record))fail('Owner preparation authorization changed.',409);
      return {preparation:{...preparation,preparedAt:new Date().toISOString()}};
    }
    const proofs=evidence.proofs.filter(p=>p.nativeUnitId===nativeId);
    if(proofs.length!==1||!matchesOwnerCensusProof(proofs[0],record,nativeId))fail('Current complete Owner source proof is unavailable.',409);
    const safeRow=r=>Object.fromEntries(['id','unitNumber','readOnly','placementSource','placement','status','currentLocationType','placementAuditId','placementUnitKey','address','locationVerification'].map(k=>[k,r[k]]));
    checkDeadline();
    return {record,map:{placementProjectionVersion:2,ownerCensusProofs:proofs,nativePlacementAliases:aliases,items:items.map(safeRow),inventoryItems:inventory.map(safeRow)}};
  };
  // Share one large-transfer slot across imports, original PDF downloads, and private evidence.
  // Binary responses retain their slot until drained/canceled; small requests remain usable.
  let activeLargeBodies = 0;
  return async function handle(request) {
    const ownerProofDeadlineMs=Date.now()+75000;
    let ownsLargeBodyPermit = false;
    let keepPermitForResponse = false, responseOwnsPermit = false;
    const releaseLargeBody = () => {
      if (ownsLargeBodyPermit) { activeLargeBodies -= 1; ownsLargeBodyPermit = false; }
    };
    const admitLargeBody = () => {
      if (ownsLargeBodyPermit) return;
      if (activeLargeBodies >= 1) fail('Another large file transfer is in progress. Wait for it to finish before retrying.', 429);
      activeLargeBodies += 1;
      ownsLargeBodyPermit = true;
    };
    const origin = request.headers.get('Origin');
    const allowedOrigin = !origin || ALLOWED_ORIGINS.has(origin);
    const cors = {
      ...(allowedOrigin ? { 'Access-Control-Allow-Origin': origin || 'https://cypressriveroasis2023-sudo.github.io' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    };
    const json = (body, status = 200) => {
      const response = new Response(JSON.stringify(body), { status, headers: cors });
      if (!keepPermitForResponse || !ownsLargeBodyPermit || !response.body) return response;
      const reader = response.body.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        reader.releaseLock();
        releaseLargeBody();
      };
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { finish(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { finish(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
      }, { highWaterMark: 0 });
      const guarded = new Response(stream, { status, headers: response.headers });
      responseOwnsPermit = true;
      return guarded;
    };
    if (!allowedOrigin) return json({ error: 'This origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!['GET', 'POST'].includes(request.method)) fail('Method not supported.', 405);
      let path = new URL(request.url).pathname.replace(/^.*\/cos-operations-(?:pages|bridge)(?=\/|$)/, '').replace(/\/$/, '');
      let method = request.method, body = null;
      const context = await authenticate(request);
      if (!path && request.method === 'POST') {
        const { body: envelope, byteLength: envelopeBytes } = await readMhelpAwareJsonWithSize(request, context.legacyOwner && context.actorId ? MHELP_JSON_LIMIT : 65536, admitLargeBody);
        const envelopeLimit = ['/api/mhelpdesk/equipment/preview','/api/mhelpdesk/equipment/stage','/api/mhelpdesk/equipment/commit'].includes(envelope.path) ? Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 16384 : envelope.path === '/api/mhelpdesk/imports/stage' ? MHELP_JSON_LIMIT : String(envelope.path || '').startsWith('/api/mhelpdesk/imports/') ? 524288 : 65536;
        if (envelopeBytes > envelopeLimit) fail('Request body is too large.', 413);
        if (Object.keys(envelope).some(k => !['path', 'method', 'body'].includes(k))) fail('Unsupported transport fields.');
        if (typeof envelope.path !== 'string' || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(envelope.path) && !(envelope.method==='GET' && envelope.path==='/api/mhelpdesk/intake/status?capability=pending_schedule_v1')) fail('COS endpoint not found.', 404);
        if (!['GET', 'POST'].includes(envelope.method)) fail('Method not supported.', 405);
        path = envelope.path.replace(/\/$/, '');
        method = envelope.method;
        body = envelope.body == null ? {} : envelope.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required.');
        if (method === 'GET' && Object.keys(body).length) fail('GET endpoints do not accept a request body.');
      }
      if (!path.startsWith('/api/')) fail('COS endpoint not found.', 404);
      if (path.startsWith('/api/tech/')) {
        if (context.legacyOwner || !['it', 'service'].includes(context.department)) fail('A signed-in technician account is required for the production queue.', 403);
        const claimRoute = /^\/api\/tech\/it-queue\/([^/]+)\/claim$/.exec(path);
        if (method !== 'GET' && !(method === 'POST' && claimRoute && context.department === 'it')) fail('This technician action is not supported.', 405);
        if (path === '/api/tech/session') return json({
          authorized: Boolean(context.actorId), legacyTechnician: true, role: context.department === 'it' ? 'IT' : 'Service',
          name: context.name, department: context.department, productionTechnicianUserId: context.actorId || null,
          reason: context.actorId ? null : 'This technician account is not linked to its own COS production identity. Your existing Tech Check remains available.',
        });
        if (!context.actorId) fail('This technician account is not linked to COS production.', 403);
        const payload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
        const visibleVisitIds = async ids => {
          if (!ids.length) return new Set();
          const visible = await rpc('cos_technician_visible_visits', { ...payload, p_visit_ids: ids });
          if (!Array.isArray(visible) || visible.some(id => !UUID.test(String(id || '')) || !ids.includes(id))) fail('Current technician visit access could not be verified.', 503);
          return new Set(visible);
        };
        if (path === '/api/tech/it-queue') {
          if (context.department !== 'it') fail('An active IT account is required for the shared queue.', 403);
          const snapshot = await rpc('cos_it_queue_snapshot', payload);
          if (!snapshot || snapshot.actorId !== context.actorId || !Array.isArray(snapshot.items) || snapshot.items.some(row => !UUID.test(String(row.visitId || '')) || !UUID.test(String(row.jobId || '')) || !['ready','claimed'].includes(row.queueStatus) || typeof row.claimable !== 'boolean' || typeof row.setupNeeded !== 'boolean' || typeof row.readinessNote !== 'string' || typeof row.nativeDispatchStatus !== 'string' || (row.queueStatus === 'ready' ? row.claimOwnerId != null : !UUID.test(String(row.claimOwnerId || ''))))) fail('Shared IT queue could not be verified.', 503);
          return json(snapshot);
        }
        if (claimRoute) {
          if (method !== 'POST' || context.department !== 'it') fail('A shared IT claim requires an IT technician POST.', 405);
          const claimBody = body || await requestBody(request);
          allowedFields(claimBody, [], 'Shared IT claim');
          const id = idValue(claimRoute[1], 'Visit');
          // Organization is fixed by the verified bridge. The RPC rechecks active
          // role/permission, lifecycle and claim ownership under the database lock.
          await assertRecord('job_visits', id);
          const claimed = await rpc('cos_claim_shared_it_visit', { p_actor_user_id: context.actorId, p_visit_id: id });
          if (!claimed || claimed.visit_id !== id || claimed.claimed_by !== context.actorId || claimed.status !== 'accepted' || typeof claimed.already_claimed !== 'boolean') fail('Claim response could not be verified. Refresh the IT queue.', 503);
          return json(claimed);
        }
        if (path === '/api/tech/my-day') return json(await rpc('appdeploy_technician_my_day', payload));
        if (path === '/api/tech/tasks') return json(await rpc('appdeploy_technician_tasks_snapshot', payload));
        if (path === '/api/tech/assignments') {
          const rows = await platformAll('visit_assignments?select=user_id,visit_id,status,assigned_at,job_visits!inner(id,job_id,visit_number,visit_type,department,status,dispatch_status,scheduled_start,scheduled_end,instructions,jobs(job_number,title,job_type,priority,customers(name),sites(name)))&user_id=eq.' + context.actorId + '&assignment_role=eq.technician&status=in.(assigned,accepted)&job_visits.organization_id=eq.' + ORGANIZATION_ID + '&job_visits.status=not.in.(completed,cancelled)&order=assigned_at.asc');
          if (rows.some(row => row.user_id !== context.actorId || !row.job_visits || row.job_visits.id !== row.visit_id || row.job_visits.department?.toLowerCase() !== context.department)) fail('COS returned an inconsistent technician assignment collection.',503);
          const visible = await visibleVisitIds(rows.map(row => row.visit_id));
          return json({ profile: { display_name: context.name, department: context.department }, visits: rows.filter(row => visible.has(row.visit_id)).map(row => {
            const v = row.job_visits, j = v?.jobs;
            return { visit_id: row.visit_id, visit_number: v?.visit_number, visit_type: v?.visit_type, department: v?.department, status: v?.status, dispatch_status: v?.dispatch_status, scheduled_start: v?.scheduled_start, scheduled_end: v?.scheduled_end, instructions: v?.instructions, assignment_status: row.status, job_id: v?.job_id, job_number: j?.job_number, job_title: j?.title, job_type: j?.job_type, priority: j?.priority, customer_name: j?.customers?.name, site_name: j?.sites?.name };
          }) });
        }
        const visitRoute = /^\/api\/tech\/visits\/([^/]+)$/.exec(path);
        if (visitRoute) {
          const id = idValue(visitRoute[1], 'Visit');
          await assertRecord('job_visits', id);
          if (!(await visibleVisitIds([id])).has(id)) fail('This visit is no longer available to your technician account.', 404);
          const assigned = await platformRead('visit_assignments?select=visit_id,user_id,assignment_role,status&visit_id=eq.' + id + '&user_id=eq.' + context.actorId + '&assignment_role=eq.technician&status=in.(assigned,accepted)&limit=1');
          if (!Array.isArray(assigned) || !assigned.some(row => row.visit_id === id && row.user_id === context.actorId && row.assignment_role === 'technician' && ['assigned','accepted'].includes(row.status))) fail('This visit is not assigned to your technician account.', 404);
          const detail = await rpc('appdeploy_technician_visit_snapshot', { ...payload, p_visit_id: id });
          if (!detail?.visit) {
            // An assigned, scheduled visit can precede physical-unit identification.
            // Do not create an execution or treat a broken existing snapshot as pending.
            if (!detail || typeof detail !== 'object' || Array.isArray(detail) || Object.keys(detail).length) fail('The assigned visit workflow could not be verified.', 503);
            const executions = await platformRead('workflow_executions?select=id&visit_id=eq.' + id + '&organization_id=eq.' + ORGANIZATION_ID + '&status=neq.cancelled&limit=1');
            if (!Array.isArray(executions) || executions.length) fail('The assigned visit workflow could not be verified. Refresh your assignments.', 503);
            // Read the current assignment and its authorized records together. Every
            // relationship is checked again rather than trusting a prior assignment.
            const rows = await platformRead('visit_assignments?select=visit_id,user_id,assignment_role,status,job_visits!inner(id,organization_id,job_id,visit_number,visit_type,department,status,dispatch_status,scheduled_start,scheduled_end,instructions,jobs!inner(id,organization_id,job_number,title,job_type,description,priority,customer_id,site_id,operational_status,customers!inner(id,organization_id,name),sites!inner(id,organization_id,customer_id,name,address_line1,address_line2,city,state_region,postal_code)))&visit_id=eq.' + id + '&user_id=eq.' + context.actorId + '&assignment_role=eq.technician&status=in.(assigned,accepted)&job_visits.organization_id=eq.' + ORGANIZATION_ID + '&job_visits.department=eq.' + context.department + '&job_visits.status=not.in.(completed,cancelled,closed)&limit=2');
            if (!Array.isArray(rows) || rows.length !== 1) fail('This visit is no longer assigned to your technician account. Refresh your assignments.', 404);
            const assignment = rows[0], visit = assignment.job_visits, job = visit?.jobs, site = job?.sites, customer = job?.customers;
            if (assignment.visit_id !== id || assignment.user_id !== context.actorId || assignment.assignment_role !== 'technician' || !['assigned','accepted'].includes(assignment.status) ||
                visit?.id !== id || visit.organization_id !== ORGANIZATION_ID || visit.department !== context.department || ['completed','cancelled','canceled','closed'].includes(visit.status) ||
                !UUID.test(String(visit.job_id || '')) || job?.id !== visit.job_id || job.organization_id !== ORGANIZATION_ID || ['closed','cancelled','canceled'].includes(job.operational_status) ||
                !UUID.test(String(job.site_id || '')) || site?.id !== job.site_id || site.organization_id !== ORGANIZATION_ID || site.customer_id !== job.customer_id ||
                !UUID.test(String(job.customer_id || '')) || customer?.id !== job.customer_id || customer.organization_id !== ORGANIZATION_ID) fail('The assigned visit records do not match your active assignment.', 503);
            return json({ execution: null, current_step: null, pendingWorkflow: true,
              visit: { id, visit_number: visit.visit_number, visit_type: visit.visit_type, department: visit.department, status: visit.status, dispatch_status: visit.dispatch_status, scheduled_start: visit.scheduled_start, scheduled_end: visit.scheduled_end, instructions: visit.instructions },
              job: { id: job.id, job_number: job.job_number, title: job.title, job_type: job.job_type, description: job.description, priority: job.priority, customer_name: customer.name },
              site: { name: site.name, address_line1: site.address_line1, address_line2: site.address_line2, city: site.city, state_region: site.state_region, postal_code: site.postal_code },
            });
          }
          if (detail.visit.id !== id) fail('The assigned visit workflow could not be verified.', 503);
          const step = detail.current_step;
          return json({ execution: detail.execution, visit: detail.visit, job: detail.job, site: detail.site, current_step: step ? { id: step.id, step_key: step.step_key, sequence_number: step.sequence_number, title: step.title, instruction: step.instruction, step_type: step.step_type, required: step.required } : null });
        }
        fail('COS technician endpoint not found.', 404);
      }
      // Keep the Owner gate closed for every endpoint outside this exact read allowlist.
      const verifiedFleetIt = verifiedItFleet(context);
      if (!context.legacyOwner && !(verifiedFleetIt && fleetRouteAllowed(method,path))) fail('An active COS Owner account is required.', 403);
      if (method === 'GET' && path === '/api/session' && verifiedFleetIt) return json({
        authorized:true, legacyOwner:false, role:'IT', name:context.name,
        features:fleetFeatures(), productionOwnerUserId:null, provisioningNeeded:null, reason:null,
      });
      if (method === 'GET' && path === '/api/session') return json({
        authorized: Boolean(context.actorId), legacyOwner: true, role: 'Owner', name: context.name,
        features: { unitTracker: Boolean(context.actorId), fleetAccess: Boolean(context.actorId), vrmRead: Boolean(context.actorId), fleetPlacementEdit: Boolean(context.actorId), fleetConnectionEdit: Boolean(context.actorId), cameraHealthV2: Boolean(context.actorId), fieldLocationVerification: Boolean(context.actorId), ownerIdentityReview: Boolean(context.actorId), mhelpTicketImport: Boolean(context.actorId), ownerEquipmentImportEnabled: Boolean(context.actorId)&&options.ownerEquipmentImportEnabled===true, deliveryGoBack: Boolean(context.actorId), legacyInstallEvidence: Boolean(context.actorId) },
        productionOwnerUserId: context.actorId || null,
        provisioningNeeded: context.actorId ? null : 'same_person_platform_auth_identity_and_owner_role',
        reason: context.actorId ? null : 'This Owner has no linked same-person COS production account. An Owner must provision that identity and its existing Owner role before linking it. Existing Tech Check tools remain available.',
      });
      if (!context.actorId) fail('This Owner account is not linked to COS production. Use the existing Tech Check tools.', 403);
      const actorPayload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
      const censusOnce=/^\/api\/field-map\/([^/]+)\/(owner-census-once|owner-census-proof|owner-census-prepare)$/.exec(path);
      if(censusOnce){
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method!=='POST')fail('An explicit Owner request is required.',405);
        if(new URL(request.url).search)fail('Query parameters are unsupported.');
        const nativeId=idValue(censusOnce[1],'Unit');
        if(body===null)body=await requestBody(request);
        const prepare=censusOnce[2]==='owner-census-prepare';
        allowedFields(body,prepare?['auditId','unitKey','addressSha256']:['auditId','unitKey','addressSha256','nativeGuardSha256']);
        if(typeof body.auditId!=='string'||!/^[1-9]\d{0,18}$/.test(body.auditId)||BigInt(body.auditId)>9223372036854775807n
          ||typeof body.unitKey!=='string'||!body.unitKey.trim()||body.unitKey!==body.unitKey.trim()||body.unitKey.length>250
          ||!(prepare?['addressSha256']:['addressSha256','nativeGuardSha256']).every(k=>typeof body[k]==='string'&&/^[a-f0-9]{64}$/.test(body[k])))fail('Exact reviewed lookup binding is required.');
        let fresh;
        try{fresh=await readOwnerCensusEnvelope(context,nativeId,body,request.signal,prepare,ownerProofDeadlineMs);}
        catch(cause){
          // Only the measured native deadline is a timeout. Preserve explicit
          // authorization/source holds and cancellation by the incoming caller.
          if(!request.signal.aborted&&Date.now()>=ownerProofDeadlineMs
            &&!(cause instanceof HttpError&&[401,403,409].includes(cause.status)))fail('Current Owner source proof deadline elapsed.',504);
          throw cause;
        }
        if(Date.now()>=ownerProofDeadlineMs)fail('Current Owner source proof deadline elapsed.',504);
        if(prepare)return json(fresh.preparation);
        if(censusOnce[2]==='owner-census-proof')return json(fresh.map);
        if(fresh.record.censusOnlyState!=='ready')fail('The enrolled Owner lookup changed or its allowance is unavailable.',409);
        let upstream;
        const forwardingDeadlineMs=Date.now()+315000,forwardingSignal=AbortSignal.timeout(315000);
        try{upstream=await requestFetch(LEGACY_URL+'/functions/v1/camera-field-geocode',{
            method:'POST',headers:{Authorization:context.authorization,'Content-Type':'application/json'},
            body:JSON.stringify({auditId:body.auditId,unitKey:body.unitKey}),redirect:'error',cache:'no-store',signal:forwardingSignal,
          });}
        catch{return json({error:'The lookup outcome is uncertain. Refresh to inspect its saved hold; do not repeat the request.',censusOnly:true,allowance:'unknown'},503);}
        if(!upstream.ok){await upstream.body?.cancel();return json({error:'The Census-only lookup could not finish. Refresh to check its hold.',censusOnly:true,allowance:'unknown'},upstream.status>=500?503:409);}
        let result;try{result=await readOwnerCensusJson(upstream,32768);}catch{fail('The lookup outcome is uncertain. Refresh before taking further action.',503);}
        if(forwardingSignal.aborted||Date.now()>=forwardingDeadlineMs)fail('The lookup outcome is uncertain. Refresh to inspect the saved result.',503);
        if(result?.ok!==true||result.censusOnly!==true||!['unknown','available','consumed'].includes(result.allowance)||!Array.isArray(result.results)||result.results.length>1
          ||!Array.isArray(result.fallbackResults)||result.fallbackResults.length||result.importedResults!==null
          ||result.results.some(r=>r?.auditId!==body.auditId||r.censusOnly!==true||!['pending','success','no_match','invalid_address','provider_error','held','superseded','draining'].includes(r.status)||!['unknown','available','consumed'].includes(r.allowance)
            ||r.censusOnlyNotBefore!==undefined&&(typeof r.censusOnlyNotBefore!=='string'||!Number.isFinite(Date.parse(r.censusOnlyNotBefore)))))fail('The lookup outcome is uncertain. Refresh to inspect the saved result.',503);
        return json({ok:true,results:result.results.map(r=>({auditId:r.auditId,status:r.status,censusOnly:true,allowance:r.allowance,...(r.censusOnlyNotBefore?{censusOnlyNotBefore:r.censusOnlyNotBefore}:{})})),fallbackResults:[],importedResults:null,censusOnly:true,allowance:result.allowance});
      }
      if(path==='/api/owner-review/legacy-evidence'){
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method!=='GET')fail('Method not supported.',405);
        if(new URL(request.url).search)fail('Evidence query parameters are unsupported.');
        allowedFields(body||{},[],'Legacy evidence request');
        // Check the same existing job-view permission as the private evidence reader,
        // with a bounded native metadata read. Legacy evidence never uses the service key.
        try{
          const roleId=idValue(context.ownerRoleId,'Owner role');
          const permission=await legacyEvidenceTransport(requestFetch,platformUrl,platformHeaders(),request.signal)('role_permissions?select=role_id,permission_code&role_id=eq.'+roleId+'&permission_code=eq.job.view_all&limit=2');
          if(!Array.isArray(permission)||permission.length!==1||permission[0]?.role_id!==roleId||permission[0]?.permission_code!=='job.view_all')throw new LegacyInstallEvidenceError(403);
          return json(await createLegacyInstallEvidenceReader(legacyEvidenceTransport(requestFetch,LEGACY_URL,context.headers,request.signal))());
        }
        catch(cause){const error=cause instanceof LegacyInstallEvidenceError?cause:new LegacyInstallEvidenceError();return json({error:error.message},error.status);}
      }
      if(path==='/api/mhelpdesk/intake/status'||path==='/api/mhelpdesk/intake/status?capability=pending_schedule_v1') {
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method!=='GET')fail('Method not supported.',405);
        allowedFields(body || {},[],'Intake status request');
        const query=new URL(request.url).search,transportOptIn=path==='/api/mhelpdesk/intake/status?capability=pending_schedule_v1';
        if(query!==''&&(query!=='?capability=pending_schedule_v1'||transportOptIn))fail('Intake status query parameters are unsupported.');
        const capability=transportOptIn||query==='?capability=pending_schedule_v1'?'pending_schedule_v1':undefined;
        try{return json(await readMhelpIntakeReview(context.authorization,request.signal,capability));}
        catch(cause){const failure=cause instanceof MhelpIntakeReviewError?cause:new MhelpIntakeReviewError();return json({error:failure.message},failure.status);}
      }
      if(path==='/api/mhelpdesk/partner/reconnect'||path==='/api/mhelpdesk/partner/reconnect/status'){
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method!=='POST'||request.method!=='POST')fail('Reconnect requires an explicit POST.',405);
        // Bearer-only auth is not ambient. Require the production UI origin and JSON as well;
        // Only the existing official app origins qualify; absent/null origins and arbitrary previews cannot configure credentials.
        if(!ALLOWED_ORIGINS.has(origin))fail('Open reconnect from the production COS Owner workspace.',403);
        if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''))fail('Reconnect requires a JSON request.',415);
        if(new URL(request.url).search)fail('Reconnect query parameters are unsupported.');
        if(!options.mhelpReconnect)fail('Secure reconnect is not available.',503);
        if(body===null)body=await readMhelpAwareJson(request,36000);
        if(new TextEncoder().encode(JSON.stringify(body)).byteLength>36000)fail('Request body is too large.',413);
        const reauthorize=async()=>{
          try{
            const fresh=await authenticate(request);
            if(!fresh.legacyOwner||!fresh.actorId||fresh.legacyId!==context.legacyId||fresh.actorId!==context.actorId||fresh.ownerRoleId!==context.ownerRoleId)throw new MhelpReconnectError(403);
          }catch{throw new MhelpReconnectError(403);}
        };
        try{return json(await (path.endsWith('/status')?options.mhelpReconnect.status(body):options.mhelpReconnect.reconnect(body,reauthorize)));}
        catch(cause){const error=cause instanceof MhelpReconnectError?cause:new MhelpReconnectError();return json({error:error.message},error.status);}
      }
      if (path.startsWith('/api/mhelpdesk/partner/')) {
        // Only the service-location read is available to the existing verified IT fleet identities.
        if (!context.legacyOwner && !(path==='/api/mhelpdesk/partner/unit-location'&&verifiedFleetIt)) fail('An active COS Owner account is required.', 403);
        if (method === 'POST' && body === null) body = await requestBody(request);
        if(path==='/api/mhelpdesk/partner/unit-location'){
          if(method!=='POST')fail('Method not supported.',405);
          if(body?.unitId===undefined)return json(await mhelpUnitLocation(body));
          allowedFields(body,['unitId','unitName'],'Unit location refresh');
          const unitId=idValue(body.unitId,'Unit');
          const target=await rpc('cos_mhelp_location_target',{...actorPayload,p_unit_id:unitId});
          if(target.unitNumber!==body.unitName||target.inactive)fail('The current unit identity must be reviewed before refreshing its service location.',409);
          const preview=await mhelpUnitLocation({unitName:target.unitNumber});
          await rpc('cos_mhelp_location_record',{...actorPayload,p_unit_id:unitId,p_guard:target.guard,p_observation:{state:'confirmed',equipmentId:preview.equipmentId,placement:preview.placement,customer:preview.customer,site:preview.site,address:preview.address||null,point:preview.point,coordinateSource:preview.coordinateSource}});
          return json({...preview,locationEvidenceUpdated:true});
        }
        if(path==='/api/mhelpdesk/partner/tickets/preview') {
          if(method!=='POST')fail('Method not supported.',405);
          if(body?.evidence===MHELP_TICKET_PRIVATE_SAMPLE){
            allowedFields(body,['evidence','ticketNumber','appointmentDay'],'Private ticket sample request');
            const now=options.now ? options.now() : new Date(),sample={ticketNumber:body.ticketNumber,appointmentDay:body.appointmentDay};
            try {validateMhelpPrivateSampleRequest(sample,now);}catch {fail('Enter a ticket number and an appointment day within 31 Chicago calendar days.');}
            try {return json(projectMhelpPrivateSample(await mhelpTickets.sample(sample,now,request.signal)));}
            catch(cause){
              const diagnostic=mhelpTicketDiagnostic(cause);
              try {(options.reportTicketPreviewFailure || (entry=>console.warn(JSON.stringify(entry))))(diagnostic.log);}catch { /* Never log source values. */ }
              return json({error:diagnostic.error},diagnostic.httpStatus);
            }
          }
          allowedFields(body || {},['day','evidence'],'Ticket preview request');
          if(body?.day!==undefined && body.day!=='previous')fail('Ticket preview day is unsupported.');
          if(body?.evidence!==undefined && body.evidence!=='operational_structure_v1' && body.evidence!=='ticket_detail_structure_v1' && body.evidence!=='appointment_structure_v1' && body.evidence!=='appointment_variants_v1')fail('Ticket preview evidence capability is unsupported.');
          try {
            const now=options.now ? options.now() : new Date();
            const window=body?.day==='previous'?mhelpPreviousDayPreviewWindow(now):mhelpTodayPreviewWindow(now);
            const evidence=body?.evidence==='appointment_variants_v1'?'appointment_variants_v1':body?.evidence==='appointment_structure_v1'?'appointment_structure_v1':body?.evidence==='ticket_detail_structure_v1'?'ticket_detail_structure_v1':body?.evidence==='operational_structure_v1'?'operational_structure_v1':undefined;
            return json(projectMhelpTicketPreview(await mhelpTickets.preview(window,evidence),evidence));
          } catch(cause) {
            const diagnostic=mhelpTicketDiagnostic(cause);
            // The log is a new fixed allowlisted object, never the error or request.
            try { (options.reportTicketPreviewFailure || (entry=>console.warn(JSON.stringify(entry))))(diagnostic.log); } catch { /* Logging cannot alter the safe response. */ }
            return json({error:diagnostic.error},diagnostic.httpStatus);
          }
        }
        return json(await mhelpPartner(path, method, body));
      }
      if(path==='/api/operational-units'||path==='/api/operational-units/move'){
        // Authenticated Owner-only local transaction; no Fleet, health or
        // provider preflight in the transfer commit path.
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method==='POST'&&body===null)body=await requestBody(request);
        return json(await createOperationalMoves({rpc,actorPayload})(path,method,body));
      }
      if(path.startsWith('/api/unit-tracker/sheets/')){
        // Connection credentials and checks stay Owner-only; existing IT
        // tracker access and permission checks are unchanged.
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method==='POST'&&body===null)body=await requestBody(request);
        return json(await sheetsConnection(path,method,body));
      }
      if(path==='/api/unit-tracker'||path.startsWith('/api/unit-tracker/')){
        if(method==='POST'&&body===null)body=await requestBody(request);
        return json(await createUnitTracker({rpc,actorPayload})(path,method,body));
      }
      if(path.startsWith('/api/owner-identity/')){
        // Deliberately outside the verified IT allowlist. No identity-approval expansion.
        if(!context.legacyOwner)fail('An active COS Owner account is required.',403);
        if(method==='POST'&&body===null)body=await requestBody(request);
        return json(await createOwnerIdentityReview({actorId:context.actorId,organizationId:ORGANIZATION_ID,rpc,
          read:async key=>{const result=await readIdentitySources(context,key);return {sources:result.reviewSources,identity:result.identity};},
        })(path,method,body));
      }
      if (path === '/api/mhelpdesk/equipment/preview') {
        // Source preview only. No equipment commit, activation, map or IP write.
        // Keep it independent from the existing mHelp service-ticket PDF importer.
        if (!context.legacyOwner || !context.actorId) fail('An active COS Owner account is required.',403);
        if (method !== 'POST') fail('Method not supported.',405);
        if (body === null) body = await readMhelpAwareJson(request,Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 8192,admitLargeBody);
        const current = await readMhelpPlacements(actorPayload);
        if (!current?.upload) fail('The previous reviewed mHelp equipment source is unavailable. No records were changed.',503);
        try {return json(await ownerEquipmentCsvReview({body,previous:current.upload,google:{getServiceAccountJson:options.googleSheets?.getServiceAccountJson||(()=>undefined),signAssertion:options.googleSheets?.signAssertion,fetch:requestFetch}}));}
        catch(e){
          if(e instanceof Error && e.message.startsWith('Invalid mHelpDesk equipment CSV:'))fail(e.message,422);
          fail('The equipment comparison is unavailable. No records were changed.',503);
        }
      }
      if (path==='/api/mhelpdesk/equipment/stage'||path==='/api/mhelpdesk/equipment/commit') {
        // Disabled unless independently reviewed private SQL, receipt storage and
        // full authenticated integration tests are explicitly enabled by Ops.
        // The service-ticket PDF import is a distinct route and stays unchanged.
        if (!context.legacyOwner || !context.actorId) fail('An active COS Owner account is required.',403);
        if (method!=='POST') fail('Method not supported.',405);
        if(options.ownerEquipmentImportEnabled!==true)fail('Protected equipment admission is not enabled. Preview remains available.',503);
        if(body===null)body=await readMhelpAwareJson(request,Math.ceil(EQUIPMENT_CSV_MAX_BYTES/3)*4+16384,admitLargeBody);
        const allowed=path.endsWith('/stage')?['bytesBase64','sourceFilename','expectedSha256','requestId']:['bytesBase64','sourceFilename','expectedSha256','stageId','confirmationText'];
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail('Invalid equipment submission.',400);
        const original={bytesBase64:body.bytesBase64,sourceFilename:body.sourceFilename,...(body.expectedSha256===undefined?{}:{expectedSha256:body.expectedSha256})};
        const current=await readMhelpPlacements(actorPayload);
        if(!current?.upload)fail('The last reviewed mHelpDesk equipment source is unavailable. No records were changed.',503);
        const common={body:original,previous:current.upload,actorId:context.actorId,organizationId:ORGANIZATION_ID,
          google:{getServiceAccountJson:options.googleSheets?.getServiceAccountJson||(()=>undefined),signAssertion:options.googleSheets?.signAssertion,fetch:requestFetch},rpc};
        try {
          return json(path.endsWith('/stage')?
            await stageOwnerEquipmentCsv({...common,requestId:body.requestId}):
            await commitOwnerEquipmentCsv({...common,stageId:body.stageId,confirmationText:body.confirmationText}));
        } catch(e){
          if(e instanceof Error && e.message.startsWith('Invalid mHelpDesk equipment CSV:'))fail(e.message,422);
          if(e instanceof Error && e.message.startsWith('Protected COS equipment admission:'))fail(e.message,409);
          fail('Current Owner equipment guards could not be verified. No source update was authorized.',503);
        }
      }
      if (path.startsWith('/api/mhelpdesk/imports')) {
        if (method === 'GET' && /^\/api\/mhelpdesk\/imports\/attachments\/[^/]+\/download$/.test(path)) {
          idValue(path.split('/')[5], 'Import record');
          admitLargeBody();
          keepPermitForResponse = true;
        }
        if (method === 'POST' && body === null) body = await readMhelpAwareJson(request, path.endsWith('/stage') ? MHELP_JSON_LIMIT : 524288, admitLargeBody);
        return json(await mhelpImport(path, method, body, context.actorId));
      }
      if (path === '/api/inhand-pilot/run') {
        if (method !== 'POST') fail('The one-use pilot requires an explicit POST.', 405);
        if (new URL(request.url).search) fail('The one-use pilot does not accept query parameters.');
        const pilotBody = body || await requestBody(request);
        allowedFields(pilotBody, []);
        return json(await readInhandPilot(context.actorId));
      }
      if (method === 'GET' && /^\/api\/evidence\/[^/]+$/.test(path)) {
        const documentId = idValue(path.split('/').pop(), 'Evidence');
        admitLargeBody();
        keepPermitForResponse = true;
        return json(await readPrivateOwnerEvidence(context.actorId, documentId));
      }
      if (method === 'GET') {
        const contactRoute = /^\/api\/customers\/([^/]+)\/contacts$/.exec(path);
        if (contactRoute) {
          const customerId = idValue(contactRoute[1], 'Customer');
          // Reuse the existing actor-scoped customer.manage permission gate. No new grant or caller-supplied organization.
          const directory = await rpc('appdeploy_customers_snapshot', actorPayload);
          if (!Array.isArray(directory?.items) || directory.items.some(row => !row || typeof row !== 'object' || Array.isArray(row) || !UUID.test(String(row.id || '')) || !['active','inactive','archived'].includes(row.status))) fail('Customer access could not be verified.', 503);
          const matches = directory.items.filter(row => row.id === customerId);
          if (matches.length !== 1) fail('Customer contacts are not available for this customer.', 404);
          if (matches[0].status !== 'active') fail('Contacts are unavailable for inactive or archived customers.', 409);
          const rows = await platformAll('customer_contacts?select=id,customer_id,name,email,phone,title,is_primary,billing_contact,customers!inner(organization_id,status)&customer_id=eq.' + customerId + '&customers.organization_id=eq.' + ORGANIZATION_ID + '&customers.status=eq.active&order=is_primary.desc,name.asc,id.asc');
          const seen = new Set();
          for (const row of rows) {
            if (!row || !UUID.test(String(row.id || '')) || seen.has(row.id) || row.customer_id !== customerId || row.customers?.organization_id !== ORGANIZATION_ID || row.customers?.status !== 'active' || !['name','email','phone','title'].every(key => row[key] == null || typeof row[key] === 'string')) fail('Customer contact records could not be verified.', 503);
            seen.add(row.id);
          }
          return json({ customerId, items: rows.map(row => ({ id: row.id, customerId, name: row.name || '', email: row.email || '', phone: row.phone || '', title: row.title || '', isPrimary: row.is_primary === true, billingContact: row.billing_contact === true })) });
        }
        // Keep the legacy nine-record response for already-open/cached clients.
        if (path === '/api/vrm-portal') {
          try { return json({ items: vrmPortalConfig(options.vrmEmbeds).items }); }
          catch { fail('VRM dashboard configuration is unavailable.', 503); }
        }
        if (path === '/api/vrm-fleet' || path === '/api/vrm-fleet/refresh') {
          try { return json(readVrmFleet ? await readVrmFleet(path.endsWith('/refresh')) : vrmPortalConfig(options.vrmEmbeds)); }
          catch { fail('VRM dashboard configuration is unavailable.', 503); }
        }
        if(path==='/api/tv-board/settings')return json(await rpc('cos_tv_board_settings_snapshot',actorPayload));
        const snapshots = {
          '/api/handoffs': 'appdeploy_handoffs_snapshot',
          '/api/customers': 'appdeploy_customers_snapshot',
          '/api/equipment': 'appdeploy_equipment_registry_snapshot',
          '/api/work-requests': 'appdeploy_work_requests_snapshot',
          '/api/team': 'appdeploy_team_snapshot',
          '/api/daily-board': 'cos_daily_board_snapshot',
          '/api/field-map': 'appdeploy_field_map_snapshot',
          '/api/owner-tasks': 'appdeploy_owner_tasks_snapshot',
          '/api/ar': 'appdeploy_invoices_snapshot',
          '/api/purchasing': 'appdeploy_purchasing_snapshot',
          '/api/financial-summary': 'appdeploy_financial_summary',
          '/api/sites': 'appdeploy_sites_snapshot',
          '/api/owner-review': 'appdeploy_owner_review_snapshot',
          '/api/owner-review/signatures': 'appdeploy_owner_review_signatures_snapshot',
        };
        if (path === '/api/daily-board') {
          const board = await rpc(snapshots[path], actorPayload);
          const jobs = withDeliveryGoBacks({ items: board.jobs }, await rpc('appdeploy_delivery_go_back_snapshot', actorPayload)).items;
          return json({ ...board, jobs });
        }
        if (path === '/api/owner-review') return json(withDeliveryGoBacks(await rpc(snapshots[path], actorPayload), await rpc('appdeploy_delivery_go_back_snapshot', actorPayload)));
        const readArchivedRepresentations=async()=>{
          try{const rows=await rpc('cos_archived_representation_projection',{p_organization_id:ORGANIZATION_ID});return Array.isArray(rows)?rows:[];}
          catch{return [];} // Unavailable evidence restores visibility; it never hides a row.
        };
        if (path === '/api/equipment') {
          const previousArchivedRepresentations=await readArchivedRepresentations();
          if(!previousArchivedRepresentations.length)return json(await rpc(snapshots[path],actorPayload));
          const [snapshot,bundle]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context)]);
          const archivedRepresentations=await readArchivedRepresentations();
          return json(projectArchivedEquipmentRegistry(snapshot,archivedRepresentations,bundle.sources.audits,bundle.sources.devices,{nativeUnits:bundle.sources.units,identity:bundle.identity,previousArchivedRepresentations}));
        }
        if (path === '/api/field-map') {
          const [snapshot,bundle]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context)]);
          const {audits,devices,units}=bundle.sources,identity=bundle.identity;
          const readSourceProjections=async(inventory=snapshot.inventoryItems)=>{
            const sourceIdentities=inventory.map(row=>({entityKind:row.readOnly===true?'tracker':'equipment_unit',nativeUnitId:row.id})),rows=[];
            for(let offset=0;offset<sourceIdentities.length;offset+=250){
              const page=await rpc('cos_geocode_sources_map_projection',{p_organization_id:ORGANIZATION_ID,p_identities:sourceIdentities.slice(offset,offset+250)});
              if(!Array.isArray(page))fail('Current imported installation sources are unavailable.',503);rows.push(...page);
            }
            return rows;
          };
          const readPrecedenceBindings=async(sources)=>{
            const bindings=(await Promise.all(sources.filter(s=>s?.sourcePrecedence!==undefined).map(checkedImportedBinding))).filter(Boolean);
            const confirmed=[];
            for(let offset=0;offset<bindings.length;offset+=250){
              try{
                const page=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_imported_precedence_read_current',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_bindings:bindings.slice(offset,offset+250)})},'Reviewed source precedence is unavailable.');
                if(!Array.isArray(page)||page.length>Math.min(250,bindings.length-offset))return [];
                confirmed.push(...(await Promise.all(page.map(checkedImportedBinding))).filter(Boolean));
              }catch{return [];}
            }
            return confirmed;
          };
          const [importedSources,archivedRepresentations]=await Promise.all([readSourceProjections(),readArchivedRepresentations()]);
          const confirmedPrecedenceBindings=await readPrecedenceBindings(importedSources);
          const initial=await projectOwnerPlacement(await projectImportedSourceAddresses(snapshot,importedSources,audits,devices,[],{nativeUnits:units,identity,archivedRepresentations,confirmedPrecedenceBindings}),audits,devices,identity,units);
          const importedBindings=(await Promise.all(initial.items.filter(row=>row.placementSource!=='owner').map(row=>checkedImportedBinding(row.importedInstallation)))).filter(Boolean);
          const importedGeocodes=[];
          for(let offset=0;offset<importedBindings.length;offset+=250){
            try{
              const bindings=importedBindings.slice(offset,offset+250);
              const page=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_imported_geocode_read_many',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_bindings:bindings})},'Imported address lookup results are unavailable.');
              // A missing job legitimately returns no row. A failed or malformed read
              // must fail the whole refresh so clients retain their labeled last-good map.
              if(!Array.isArray(page)||page.length>bindings.length)throw Error('Invalid imported lookup page');
              const expected=new Set(bindings.map(binding=>JSON.stringify(binding))),seen=new Set();
              for(const row of page){
                const binding=await checkedImportedBinding(row?.binding),key=binding&&JSON.stringify(binding);
                if(!key||!expected.has(key)||seen.has(key)||row.jobKind!=='native_import'||row.verified!==false||row.liveGps!==false
                  ||typeof row.legacyGuardSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.legacyGuardSha256)
                  ||!['pending','deferred','success','no_match','invalid_address','provider_error','held'].includes(row.status))throw Error('Invalid imported lookup record');
                seen.add(key);
              }
              importedGeocodes.push(...page);
            }catch{fail('Imported address lookup results are unavailable. The map could not be refreshed.',503);}
          }
          const ids=[...new Set(initial.items.filter(row=>row.placementSource==='owner'&&row.placementAuditId).map(row=>row.placementAuditId))];
          const geocodes=[],fallbackGeocodes=[];let censusUnavailable=false;
          try{
            for(let offset=0;offset<ids.length;offset+=250){
              const page=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_field_geocode_read_many',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_audit_ids:ids.slice(offset,offset+250)})},'Saved address lookup results are unavailable.');
              if(!Array.isArray(page))fail('Address lookup returned invalid results.',503);geocodes.push(...page);
              try{
                const fallback=await readJson(LEGACY_URL+'/rest/v1/rpc/cos_field_geocode_fallback_read_many',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_organization_id:ORGANIZATION_ID,p_audit_ids:ids.slice(offset,offset+250)})},'Saved address fallback results are unavailable.');
                if(Array.isArray(fallback))fallbackGeocodes.push(...fallback);
              }catch{/* Preserve safe Census results if fallback read fails. */}
            }
          }catch{censusUnavailable=true;geocodes.length=0;fallbackGeocodes.length=0;}
          // Cross-project reads are not a distributed transaction. Re-read both authorities
          // after lookups, and never publish an imported overlay with a changed source guard.
          const [freshSnapshot,freshBundle,mhelpReceipt]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context),readMhelpPlacements(actorPayload)]);
          const {audits:freshAudits,devices:freshDevices,units:freshUnits}=freshBundle.sources;
          const [freshSources,freshArchivedRepresentations,sourceRecorded]=await Promise.all([readSourceProjections(freshSnapshot.inventoryItems),readArchivedRepresentations(),readSourceRecordedCoordinates(freshSnapshot.inventoryItems,rpc)]);
          const archiveContext={nativeUnits:freshUnits,identity:freshBundle.identity,archivedRepresentations:freshArchivedRepresentations,previousArchivedRepresentations:archivedRepresentations};
          const freshSourceContext={...archiveContext,currentSources:freshSources,confirmedPrecedenceBindings:await readPrecedenceBindings(freshSources)};
          const base=await projectOwnerPlacement(await projectImportedSourceAddresses(freshSnapshot,freshSources,freshAudits,freshDevices,importedSources,freshSourceContext),freshAudits,freshDevices,freshBundle.identity,freshUnits);
          const ownerCensusEvidence=await readOwnerCensusEvidence({actorId:context.actorId,records:context.legacyOwner?geocodes:geocodes.filter(r=>r.censusOnlyState==='consumed'&&r.status==='success'),rawSnapshot:freshSnapshot,snapshot:base,bundle:freshBundle,mhelpReceipt,
            readTarget:id=>readOwnerCensusTarget(context,geocodes.find(r=>r.censusOnlyGuard?.nativeUnitId===id)?.unitKey,id)},context.legacyOwner);
          let projected=await projectFieldGeocodes({...base,ownerCensusProofs:ownerCensusEvidence.proofs},geocodes,censusUnavailable,ownerCensusEvidence.receipts,context.legacyOwner);
          try{projected=await projectFallbackGeocodes(projected,fallbackGeocodes);}catch{/* Fail closed for malformed fallback results. */}
          try{projected=await projectImportedGeocodes(projected,importedGeocodes,freshAudits,freshDevices,freshSourceContext);}catch{fail('Imported address lookup results are unavailable. The map could not be refreshed.',503);}
          projected=await projectReviewedAddressEstimates(projected,freshAudits,freshDevices,placementMatchKey);
          projected=await projectSourceRecordedCoordinates(projected,sourceRecorded,freshAudits,freshDevices);
          projected=await projectFieldRecorderAuthority(projectArchivedRepresentations(projected,freshArchivedRepresentations,freshAudits,freshDevices,archiveContext),freshBundle.sources,freshBundle.identity);
          const locationProofs=await validatedLocationProofs(projected,Date.now(),{originalInventory:freshSnapshot.inventoryItems});
          const savedPlacement=projectMhelpFleetLocations(mhelpReceipt?projectMhelpFieldPlacement(projected,mhelpReceipt,freshAudits,freshBundle.identity,Date.now(),{validatedLocationProofs:locationProofs}):projected,mhelpReceipt?.fleetLocations);
          const uploaded=projectMhelpUploadPlacement(savedPlacement,mhelpReceipt?.upload,freshAudits,freshBundle.identity,Date.now(),{validatedLocationProofs:locationProofs});
          const currentTracker=projectCurrentTrackerPlacement(uploaded.snapshot,freshAudits,freshBundle.identity,{validatedLocationProofs:locationProofs});
          const effective=projectEffectiveFleetPlacement(currentTracker,freshAudits,{confirmedPrecedenceBindings:freshSourceContext.confirmedPrecedenceBindings,authorizedUploadPlacements:uploaded.authorities});
          const combined=projectCombinedFleetRoster(effective,freshAudits,freshBundle.identity);
          // MHelp Field address is a presentation location by Product ID, never
          // a native GPS or camera association. This optional authenticated
          // read must not stop camera health, Fleet, Shop, or existing GPS pins.
          const withMhelpAddress=await withMhelpAddressMap(combined,mhelpReceipt?.upload,signal=>rpc('cos_mhelp_census_map_snapshot',actorPayload,signal),request.signal);
          // Only privately reviewed saved receipts are read through the existing
          // native actor/permission route. No new legacy credential or provider call.
          try{
            const candidates=await sourceEquipmentAddressCandidates(withMhelpAddress,mhelpReceipt?.upload);
            if(!candidates.length)return json(withMhelpAddress);
            // This optional receipt read and projection have a two-second added-latency ceiling.
            // Race explicitly: a transport that ignores abort must not hold the map open.
            const controller=new AbortController(),deadline=Date.now()+2000;
            const unavailable=()=>({...withMhelpAddress,sourceEquipmentEstimates:undefined,sourceEquipmentEstimatesStatus:'unavailable'});
            let cancel=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
            const stopped=new Promise(resolve=>{
              cancel=()=>{controller.abort();resolve(unavailable());};
              timer=setTimeout(cancel,2000);
              request.signal.addEventListener('abort',cancel,{once:true});
            });
            try{
              if(request.signal.aborted)cancel();
              const operation=(async()=>{
                if(controller.signal.aborted)return unavailable();
                const reviewed=await rpc('cos_source_equipment_estimates_snapshot',actorPayload,controller.signal);
                if(controller.signal.aborted||Date.now()>=deadline)return unavailable();
                const projected=await projectSourceEquipmentAddressEstimates(withMhelpAddress,mhelpReceipt.upload,reviewed?.records,reviewed);
                return controller.signal.aborted||Date.now()>=deadline?unavailable():projected;
              })().catch(()=>unavailable());
              const result=await Promise.race([operation,stopped]);
              return json(controller.signal.aborted||Date.now()>=deadline?unavailable():result);
            }finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);controller.abort();}
          }catch{return json({...withMhelpAddress,sourceEquipmentEstimatesStatus:'unavailable'});}
        }
        if (snapshots[path]) return json(await rpc(snapshots[path], actorPayload));
        if (path === '/api/jobs') {
          const snapshot = withDeliveryGoBacks(await rpc('appdeploy_owner_jobs_snapshot', actorPayload), await rpc('appdeploy_delivery_go_back_snapshot', actorPayload));
          const visits = [...new Set((snapshot.items || []).map(item => item.visitId).filter(id => typeof id === 'string' && UUID.test(id)))];
          const assignments = visits.length ? await platformAll('visit_assignments?select=visit_id,user_id,assigned_at,job_visits!inner(organization_id)&assignment_role=eq.technician&status=in.(assigned,accepted)&visit_id=in.(' + visits.join(',') + ')&job_visits.organization_id=eq.' + ORGANIZATION_ID + '&order=assigned_at.desc') : [];
          const byVisit = new Map();
          for (const assignment of assignments) if (!byVisit.has(assignment.visit_id)) byVisit.set(assignment.visit_id, assignment.user_id);
          const queue = await rpc('cos_it_queue_owner_snapshot', actorPayload);
          if (!Array.isArray(queue?.items) || queue.items.some(row => !UUID.test(String(row.visitId || '')) || row.assignmentMode !== 'it_queue' || !['scheduled','ready','claimed'].includes(row.queueStatus) || (row.queueStatus === 'claimed' ? !UUID.test(String(row.claimOwnerId || '')) : row.claimOwnerId != null))) fail('Shared IT scheduling state could not be verified.', 503);
          const queueByVisit = new Map(queue.items.map(row => [row.visitId, row]));
          return json({ ...snapshot, items: (snapshot.items || []).map(item => {
            const shared = queueByVisit.get(item.visitId);
            return { ...item, technicianUserId: byVisit.get(item.visitId) || null, assignmentMode: shared ? 'it_queue' : 'technician', queueStatus: shared?.queueStatus || null, claimOwnerId: shared?.claimOwnerId || null };
          }) });
        }
        const detailRoute = /^\/api\/(quotes|ar|purchasing)\/([^/]+)$/.exec(path);
        if (detailRoute) {
          const contracts = { quotes: ['quotes', 'appdeploy_quote_detail', 'p_quote_id'], ar: ['invoices', 'appdeploy_invoice_detail', 'p_invoice_id'], purchasing: ['purchase_orders', 'appdeploy_purchase_order_detail', 'p_purchase_order_id'] };
          const [table, name, parameter] = contracts[detailRoute[1]], id = idValue(detailRoute[2], 'Record');
          await assertRecord(table, id);
          return json(await rpc(name, { p_actor_user_id: context.actorId, [parameter]: id }));
        }
        if (path === '/api/team-production') {
          const members = await platformRead('user_profiles?select=user_id,display_name,department,active&organization_id=eq.' + ORGANIZATION_ID + '&active=eq.true&department=in.(it,service)&order=display_name.asc');
          return json({ items: members.map(m => ({ userId: m.user_id, displayName: m.display_name, department: m.department, active: m.active, linked: true })) });
        }
        if (path === '/api/owner/control-data') {
          const [sites, truckChecks, team] = await Promise.all([
            platformAll('sites?select=id,name,customer_id,customers(name)&organization_id=eq.' + ORGANIZATION_ID + '&status=eq.active&order=name.asc'),
            rpc('appdeploy_owner_truck_checks_snapshot', actorPayload),
            platformRead('user_profiles?select=display_name,department&organization_id=eq.' + ORGANIZATION_ID + '&active=eq.true&department=in.(it,service)&order=display_name.asc'),
          ]);
          return json({ sites, truckChecks: truckChecks.items || [], serviceTechnicians: team.filter(t => t.department === 'service').map(t => t.display_name), itTechnicians: team.filter(t => t.department === 'it').map(t => t.display_name) });
        }
        if (path === '/api/quotes') {
          const rows = await platformAll('quotes?select=id,quote_number,current_version,status,issue_date,valid_until,created_at,customers(name),sites(name),quote_versions(version_number,status,total,notes,title,scope,discount_total,tax_total),jobs(job_number)&organization_id=eq.' + ORGANIZATION_ID + '&order=quote_number.asc');
          const statuses = { draft: 'Draft', review: 'Pending Owner Approval', approved: 'Owner Approved', sent: 'Sent', accepted: 'Customer Accepted', declined: 'Customer Declined', changes_requested: 'Customer Changes Requested', returned: 'Returned by Owner' };
          return json({ items: rows.map(r => {
            const v = (r.quote_versions || []).find(q => Number(q.version_number) === Number(r.current_version)) || r.quote_versions?.[0];
            const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
            return { id: r.id, quoteNumber: r.quote_number, customer: r.customers?.name || '', site: r.sites?.name || '', title: v?.title || '', description: v?.scope || v?.notes || '', amount: Number(v?.total || 0), discountTotal: Number(v?.discount_total || 0), taxTotal: Number(v?.tax_total || 0), issueDate: r.issue_date, validUntil: r.valid_until, status: statuses[r.status] || r.status, locked: r.status !== 'draft', revision: Number(r.current_version) || 1, jobNumber: job?.job_number, activity: ['Production record · Supabase system of record'] };
          }) });
        }

        if (path === '/api/routers') {
          const [routers, units] = await Promise.all([
            legacyAll('camera_unit_routers?select=id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,current_status,last_checked_at,last_online_at,reported_status,reported_latency_ms,status_source,status_observed_at&order=id.asc', context.headers),
            platformAll('equipment_units?select=id,unit_number&organization_id=eq.' + ORGANIZATION_ID + '&order=id.asc'),
          ]);
          return json(routerSnapshot(routers, units));
        }
        // V2 is additive so currently released clients retain their exact v1 contract.
        if (path === '/api/camera-health/summary-v2') {
          const [devices, health, tracker, witnessIntegrations] = await Promise.all([
            legacyAll('camera_devices?select=id,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,source_status,source_last_seen_at,last_online_at,last_probe_online_at,activation_state,recon_battery_percent:source_metadata->battery_percent,recon_battery_updated_at:source_metadata->>battery_updated_at,recon_battery_status:source_metadata->>battery_status,recon_battery_status_updated_at:source_metadata->>battery_status_updated_at&order=id.asc', context.headers),
            legacyAll('camera_health_current?select=camera_device_id,port_status,overall_status,checked_at,ip_reachable,confirmed_outage,consecutive_failures&order=camera_device_id.asc', context.headers),
            legacyAll('equipment_master?select=canonical_family,unit_tag,source_label,tracker_state,health_provider&canonical_family=in.(Helios,Ranger,Solar Spotter,Spotter,SS Hybrid,CAMV,Sniper,Sniper 2,Sniper 4,Recon,Recon 2)&order=canonical_family.asc,unit_tag.asc,source_label.asc', context.headers),
            legacyAll('camera_integrations?select=provider,units:metadata->units&provider=eq.witness&order=provider.asc', context.headers),
          ]);
          return json(cameraSummary(devices, health, Date.now(), tracker, witnessIntegrations));
        }
        if (path === '/api/camera-health/summary-v3') {
          // Optional Recon proof must not hold the existing health response open.
          // Reuse the authorized reader without exposing tracker tables or adding grants.
          const readReconSources=async()=>{
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
            try {
              const [integrations,snapshot]=await Promise.all([
                readJson(LEGACY_URL+'/rest/v1/camera_integrations?select=provider,enabled,last_sync_at,last_sync_status,identity_inventory:metadata->identity_inventory_v1&provider=eq.reconeyez&order=provider.asc&limit=2',{headers:context.headers,signal:controller.signal},'Reconeyez inventory is unavailable.'),
                readJson(platformUrl+'/rest/v1/rpc/appdeploy_field_map_snapshot',{method:'POST',headers:platformHeaders(),body:JSON.stringify(actorPayload),signal:controller.signal},'Recon II tracker proof is unavailable.'),
              ]);
              return {integrations:Array.isArray(integrations)?integrations:[],units:snapshot?.inventoryItems||snapshot?.items||[]};
            } catch { return {integrations:[],units:[]}; }
            finally {clearTimeout(timer);controller.abort();}
          };
          const [bundle,health,tracker,providerIntegrations,reconSources]=await Promise.all([
            readIdentitySources(context),
            legacyAll('camera_health_current?select=camera_device_id,port_status,overall_status,checked_at,ip_reachable,confirmed_outage,consecutive_failures&order=camera_device_id.asc', context.headers),
            legacyAll('equipment_master?select=canonical_family,unit_tag,source_label,tracker_state,health_provider&canonical_family=in.(Helios,Ranger,Solar Spotter,Spotter,SS Hybrid,CAMV,Sniper,Sniper 2,Sniper 4,Recon,Recon 2)&order=canonical_family.asc,unit_tag.asc,source_label.asc', context.headers),
            legacyAll('camera_integrations?select=provider,enabled,last_sync_at,last_sync_status,units:metadata->units&provider=in.(witness,vigilant)&order=provider.asc', context.headers),
            readReconSources(),
          ]);
          const {devices,audits:placementAudits}=bundle.sources,identity=bundle.identity;
          const witnessIntegrations=providerIntegrations.filter(row=>row.provider==='witness');
          const recon=await projectReconProviderIdentities(reconSources.units,devices,reconSources.integrations)
            .catch(()=>projectReconProviderIdentities([],devices,[]));
          const mhelpReceipt=await readMhelpCameraPlacements(actorPayload);
          const placedDevices=mhelpReceipt?projectMhelpCameraPlacement(devices,mhelpReceipt,placementAudits,identity):devices;
          const summary={...placementCameraSummary(projectCameraOwnerPlacement(placedDevices,placementAudits), health, Date.now(), tracker, witnessIntegrations),...appendReconProviderIdentities(identity,recon),...fieldRecorderHealthGuards(bundle.sources,identity,providerIntegrations),...(mhelpReceipt?{mhelpPlacementSync:{lastSuccessAt:mhelpReceipt.lastSuccessAt,sheetsPublisher:false}}:{})};
          // Current guarded source placement only classifies synthetic PDF inventory.
          // This is optional, bounded, read-only and never changes a camera resource.
          const shopRead=(inventory,current,mhelpReceipt)=>({inventory,mhelpReceipt:mhelpReceipt??(options.mhelpPlacementEnabled===true?{}:null),nativeUnits:current.sources.units,devices:current.sources.devices,audits:current.sources.audits,identity:current.identity,matches:current.sources.matches,ownerClaims:current.sources.ownerCrosswalk.claims});
          return json(await currentTrackerShopScope(summary,tracker,shopRead(reconSources.units,bundle,mhelpReceipt),{
            onFallback:reason=>console.warn('camera_shop_scope_fallback',reason),
            readSources:async(inventory,signal)=>{
              const identities=inventory.map(row=>({entityKind:row.readOnly===true?'tracker':'equipment_unit',nativeUnitId:row.id})),seen=new Set();
              if(identities.length>100000||identities.some(row=>!UUID.test(String(row.nativeUnitId||'')))||new Set(identities.map(row=>row.entityKind+'|'+row.nativeUnitId)).size!==identities.length)throw Error('SHOP inventory identities are invalid.');
              const pages=new Array(Math.ceil(identities.length/250));let next=0;
              const worker=async()=>{for(;;){
                signal.throwIfAborted();const pageIndex=next++;if(pageIndex>=pages.length)return;
                const pageIds=identities.slice(pageIndex*250,(pageIndex+1)*250),expected=new Set(pageIds.map(row=>row.entityKind+'|'+row.nativeUnitId));
                const page=await rpc('cos_geocode_sources_map_projection',{p_organization_id:ORGANIZATION_ID,p_identities:pageIds},signal);
                if(!Array.isArray(page)||page.length>pageIds.length)throw Error('SHOP source page is unavailable.');
                for(const row of page){const key=row?.entityKind+'|'+row?.nativeUnitId;if(!expected.has(key)||seen.has(key))throw Error('SHOP source identity changed.');seen.add(key);}
                pages[pageIndex]=page;
              }};
              await Promise.all(Array.from({length:Math.min(4,pages.length)},worker));
              signal.throwIfAborted();return pages.flat();
            },
            readCurrent:async(signal)=>{
              const [snapshot,current,mhelpReceipt]=await Promise.all([rpc('appdeploy_field_map_snapshot',actorPayload,signal),readIdentitySources(context,null,signal),readMhelpCameraPlacements(actorPayload,signal)]);
              if(!Array.isArray(snapshot?.inventoryItems))throw Error('Current SHOP inventory is unavailable.');
              return shopRead(snapshot.inventoryItems,current,mhelpReceipt);
            },
          }));
        }
        if (path === '/api/camera-health/summary') {
          const [devices, health] = await Promise.all([
            legacyAll('camera_devices?select=id,device_name,device_type,organization,unit_key,source_status,source_last_seen_at,last_health_checked_at,activation_state&order=id.asc', context.headers),
            legacyAll('camera_health_current?select=camera_device_id,port_status,overall_status,confirmed_outage&order=camera_device_id.asc', context.headers),
          ]);
          const shopIds = new Set(devices.filter(d => ['root', 'shop'].includes(String(d.organization || '').trim().toLowerCase())).map(d => d.id));
          const byId = new Map(health.map(h => [h.camera_device_id, h]));
          const rows = devices.filter(d => !shopIds.has(d.id)).map(d => {
            const h = byId.get(d.id) || {}, raw = String(h.overall_status || d.source_status || 'unknown').toLowerCase();
            const status = h.confirmed_outage === true || raw === 'offline' ? 'offline' : raw === 'online' ? 'online' : 'review';
            return { id: d.id, name: d.device_name || d.unit_key || ('Camera ' + d.id), unit: d.unit_key || '', type: d.device_type || '', organization: d.organization || '', status, checkedAt: d.source_last_seen_at || d.last_health_checked_at || null };
          }).sort((a, b) => a.name.localeCompare(b.name));
          return json({ totalDevices: devices.length, healthRows: health.length, fieldDevices: rows.length, shopRoot: shopIds.size, online: rows.filter(r => r.status === 'online').length, offline: rows.filter(r => r.status === 'offline').length, review: rows.filter(r => r.status === 'review').length, rows, refreshedAt: new Date().toISOString(), source: 'Camera Health' });
        }
        const history = /^\/api\/field-map\/([^/]+)\/history$/.exec(path);
        if (history) {
          const id = idValue(history[1], 'Unit');
          await assertRecord('equipment_units', id);
          return json(await rpc('appdeploy_unit_location_history', { p_actor_user_id: context.actorId, p_unit_id: id }));
        }
        fail('COS endpoint not found.', 404);
      }
      if (!body) body = await requestBody(request);
      if (['p_actor_user_id', 'actorId', 'organizationId', 'p_organization_id'].some(k => k in body)) fail('Caller identity and organization are determined by sign-in.');
      const directoryRoute = /^\/api\/(customers|sites|equipment)(?:\/([^/]+))?$/.exec(path);
      if (directoryRoute) {
        const kind = directoryRoute[1], id = directoryRoute[2] ? idValue(directoryRoute[2], 'Record') : null;
        const table = kind === 'equipment' ? 'equipment_units' : kind;
        if (id) await assertRecord(table, id);
        let payload, name, parameter;
        if (kind === 'customers') {
          allowedFields(body, ['name','legalName','notes','status'], 'Customer request');
          payload = { name: textValue(body.name,'Customer name',true,250), legalName: textValue(body.legalName,'Legal name',false,250), notes: textValue(body.notes,'Customer notes',false,12000), status: enumValue(body.status,'Status',['active','inactive'],'active') };
          name = 'appdeploy_save_customer'; parameter = 'p_customer_id';
        } else if (kind === 'sites') {
          const fields = ['customerId','name','addressLine1','addressLine2','city','stateRegion','postalCode','country','accessInstructions','parkingInstructions','safetyNotes','operationalNotes','status'];
          allowedFields(body, fields, 'Site request');
          const customerId = idValue(body.customerId,'Customer');
          await assertRecord('customers',customerId);
          payload = { customerId, name: textValue(body.name,'Site name',true,250), status: enumValue(body.status,'Status',['active','inactive'],'active') };
          for (const field of fields.filter(field => !['customerId','name','status'].includes(field))) payload[field] = textValue(body[field],field,false,field.endsWith('Instructions') || field.endsWith('Notes') ? 12000 : 250);
          payload.country = (payload.country || 'US').toUpperCase();
          if (!/^[A-Z]{2}$/.test(payload.country)) fail('Country must use a two-letter country code.');
          name = 'appdeploy_save_site'; parameter = 'p_site_id';
        } else {
          allowedFields(body,['modelId','unitNumber','serialNumber','status','currentLocationType'],'Equipment request');
          const modelId = idValue(body.modelId,'Equipment model');
          await assertRecord('equipment_models',modelId);
          payload = { modelId, unitNumber: textValue(body.unitNumber,'Unit number',true,160), serialNumber: textValue(body.serialNumber,'Serial number',false,160), status: enumValue(body.status,'Equipment status',['new','available','prep','ready','assigned','in_transit','installed','returning','intake','repair','quarantine','retired'],'available'), currentLocationType: textValue(body.currentLocationType,'Location type',false,160) };
          name = 'appdeploy_save_equipment_unit'; parameter = 'p_unit_id';
        }
        return json(await rpc(name, { ...actorPayload, [parameter]: id, p_payload: payload }), id ? 200 : 201);
      }
      const quoteAction = /^\/api\/quotes\/([^/]+)\/action$/.exec(path);
      if (quoteAction) {
        allowedFields(body,['action','reason'],'Quote review request');
        const action = enumValue(body.action,'Quote action',['approve','return'],null);
        const reason = textValue(body.reason,'Return reason',action === 'return');
        const id = idValue(quoteAction[1],'Quote');
        await assertRecord('quotes',id);
        return json(await rpc('appdeploy_review_quote_owner_approval', { p_actor_user_id: context.actorId, p_quote_id: id, p_action: action, p_notes: reason }));
      }
      const invoiceAction = /^\/api\/ar\/([^/]+)\/action$/.exec(path);
      if (invoiceAction) {
        allowedFields(body,['action'],'Invoice request');
        const action = enumValue(body.action,'Invoice action',['approve','issue'],null), id = idValue(invoiceAction[1],'Invoice');
        await assertRecord('invoices',id);
        return json(await rpc(action === 'approve' ? 'appdeploy_approve_invoice' : 'appdeploy_issue_invoice', { p_actor_user_id: context.actorId, p_invoice_id: id }));
      }
      const purchasingAction = /^\/api\/purchasing\/([^/]+)\/(po-review|approve|return)$/.exec(path);
      if (purchasingAction) {
        const id = idValue(purchasingAction[1],'Purchase order'), payload = { p_actor_user_id: context.actorId, p_purchase_order_id: id };
        await assertRecord('purchase_orders',id);
        if (purchasingAction[2] === 'po-review') {
          allowedFields(body,['action','reason'],'Purchase request review');
          const action = enumValue(body.action,'PO action',['approve','return'],null);
          return json(await rpc('appdeploy_review_purchase_order', { ...payload, p_action: action, p_reason: textValue(body.reason,'Return reason',action === 'return') }));
        }
        allowedFields(body,[],'AP review request');
        return json(await rpc(purchasingAction[2] === 'approve' ? 'appdeploy_approve_purchase_for_payment' : 'appdeploy_return_purchase_for_review',payload));
      }
      const gpsRoute = /^\/api\/field-map\/([^/]+)\/gps$/.exec(path);
      if (gpsRoute) {
        const id = idValue(gpsRoute[1], 'Unit'), input = gps(body);
        await assertRecord('equipment_units', id);
        return json(await rpc('appdeploy_set_unit_gps', { p_actor_user_id: context.actorId, p_unit_id: id, p_latitude: input.latitude, p_longitude: input.longitude, p_accuracy_m: input.accuracyM, p_source: input.source, p_note: input.note }));
      }
      if (path === '/api/owner-tasks') {
        const allowed = new Set(['id', 'title', 'instructions', 'priority', 'assignedUserId', 'assignedDepartment', 'relatedJobId', 'relatedSiteId', 'dueAt', 'ownerNotes']);
        if (Object.keys(body).some(k => !allowed.has(k))) fail('Task request contains unsupported fields.');
        const id = idValue(body.id, 'Task', false);
        const priority = textValue(body.priority, 'Priority') || 'medium';
        if (!['high', 'medium', 'low'].includes(priority)) fail('Priority must be high, medium or low.');
        const dueAt = textValue(body.dueAt, 'Due date', false, 100);
        if (dueAt && (!/^\d{4}-\d{2}-\d{2}T/.test(dueAt) || !Number.isFinite(Date.parse(dueAt)))) fail('Due date must be a valid ISO timestamp.');
        if (id) await assertRecord('owner_tasks', id);
        const payload = { title: textValue(body.title, 'Task title', true, 180), instructions: textValue(body.instructions, 'Task instructions', false, 12000), priority, assignedUserId: idValue(body.assignedUserId, 'Technician', false), assignedDepartment: textValue(body.assignedDepartment, 'Department'), relatedJobId: idValue(body.relatedJobId, 'Job', false), relatedSiteId: idValue(body.relatedSiteId, 'Site', false), dueAt, ownerNotes: textValue(body.ownerNotes, 'Owner notes', false, 12000) };
        return json(await rpc('appdeploy_save_owner_task', { ...actorPayload, p_task_id: id, p_payload: payload }), id ? 200 : 201);
      }
      if (path === '/api/owner/jobs/manual') {
        allowedFields(body,['siteId','jobType','title','description','priority','shopPrep'],'Manual job request');
        const id = idValue(body.siteId, 'Site');
        await assertRecord('sites', id);
        const jobType = (textValue(body.jobType, 'Job type', true) || '').toUpperCase();
        if (!['DELIVERY', 'SWAP', 'PICKUP', 'SERVICE'].includes(jobType)) fail('Choose Delivery, Swap, Pickup or Service.');
        const priority = textValue(body.priority, 'Priority') || 'normal';
        if (!['low', 'normal', 'high', 'urgent'].includes(priority)) fail('Choose a valid priority.');
        if (body.shopPrep != null && typeof body.shopPrep !== 'boolean') fail('Shop prep must be true or false.');
        return json(await rpc('appdeploy_owner_create_manual_job', { p_actor_user_id: context.actorId, p_site_id: id, p_job_type: jobType, p_title: textValue(body.title, 'Title', true, 250), p_description: textValue(body.description, 'Description', false, 12000), p_priority: priority, p_requires_shop_prep: body.shopPrep === true }), 201);
      }
      if(path==='/api/tv-board/settings'){
        allowedFields(body,['sections','expectedRevision'],'TV settings');
        let sections;try{sections=checkedTvSections(body.sections);}catch{fail('Choose valid TV board sections.');}
        if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail('Refresh TV settings before saving.');
        return json(await rpc('cos_tv_board_settings_save',{...actorPayload,p_sections:sections,p_expected_revision:body.expectedRevision}));
      }
      const truck = /^\/api\/owner\/truck-checks\/([^/]+)\/approve$/.exec(path);
      if (truck) {
        allowedFields(body,['note'],'Truck approval request');
        const id = idValue(truck[1], 'Truck check');
        await assertRecord('truck_checks', id);
        return json(await rpc('appdeploy_owner_approve_truck_stock', { p_actor_user_id: context.actorId, p_check_id: id, p_note: textValue(body.note, 'Owner note') }));
      }
      const advance = /^\/api\/owner\/jobs\/([^/]+)\/advance-it$/.exec(path);
      if (advance) {
        allowedFields(body,['note','unitNumber','serviceTechnician','start','end'],'IT-to-Service request');
        const id = idValue(advance[1], 'Job'), s = schedule(body, true);
        await assertRecord('jobs', id);
        return json(await rpc('appdeploy_owner_advance_it_to_service', { p_actor_user_id: context.actorId, p_job_id: id, p_note: textValue(body.note, 'Owner note'), p_unit_number: textValue(body.unitNumber, 'Unit number'), p_service_technician_name: textValue(body.serviceTechnician, 'Technician'), p_start_local: s.start, p_end_local: s.end }));
      }
      const goBack = /^\/api\/jobs\/([^/]+)\/go-back$/.exec(path);
      if (goBack) {
        allowedFields(body,['requestId','reason','remainingWork','partsNeeded','returnNotes'],'Go-back request');
        const id = idValue(goBack[1], 'Job'), requestId = idValue(body.requestId, 'Request');
        const reason = textValue(body.reason, 'Reason'), remainingWork = textValue(body.remainingWork, 'Remaining work');
        const partsNeeded = textValue(body.partsNeeded, 'Parts needed'), returnNotes = textValue(body.returnNotes, 'Return visit notes');
        if (!reason && !remainingWork) fail('Add a reason or remaining work before saving a go-back.');
        await assertRecord('jobs', id);
        return json(await rpc('appdeploy_request_delivery_go_back', { ...actorPayload, p_job_id: id, p_request_id: requestId,
          p_reason: reason, p_remaining_work: remainingWork, p_parts_needed: partsNeeded, p_return_notes: returnNotes }));
      }
      const job = /^\/api\/jobs\/([^/]+)\/(schedule|assign|release-it|dispatch|close|remove|owner-review)$/.exec(path);
      if (job) {
        const fields = { schedule:['start','end','technician','assignmentMode'], assign:['technician'], 'release-it':[], dispatch:[], close:['reason'], remove:['confirmation'], 'owner-review':['action','reason'] };
        allowedFields(body,fields[job[2]],'Job request');
        const id = idValue(job[1], 'Job'), payload = { p_actor_user_id: context.actorId, p_job_id: id };
        const record = await assertRecord('jobs', id, job[2] === 'remove' ? 'id,job_number' : 'id');
        if (job[2] === 'schedule') {
          const s = schedule(body);
          const mode = enumValue(body.assignmentMode, 'Assignment mode', ['technician','it_queue'], 'technician');
          if (mode === 'it_queue') {
            if (body.technician != null && body.technician !== '') fail('Choose the shared IT queue or one technician.');
            return json(await rpc('cos_schedule_shared_it_visit', { ...payload, p_start_local: s.start, p_end_local: s.end }));
          }
          return json(await rpc(body.assignmentMode === 'technician' ? 'cos_schedule_named_visit' : 'appdeploy_schedule_current_visit', { ...payload, p_start_local: s.start, p_end_local: s.end, p_technician_name: textValue(body.technician, 'Technician', true, 160) }));
        }
        if (job[2] === 'assign') return json(await rpc('appdeploy_assign_current_visit', { ...payload, p_technician_name: textValue(body.technician, 'Technician', true, 160) }));
        if (job[2] === 'release-it') return json(await rpc('cos_release_shared_it_visit', payload));
        if (job[2] === 'dispatch') return json(await rpc('cos_dispatch_shared_it_visit', payload));
        if (job[2] === 'remove') {
          const confirmation = textValue(body.confirmation, 'Removal confirmation', true, 160);
          if (confirmation !== 'DELETE ' + record.job_number) fail('Type DELETE followed by the exact COS Job number.');
          return json(await rpc('appdeploy_owner_delete_job', { ...payload, p_confirmation: confirmation }));
        }
        if (job[2] === 'close') return json(await rpc('appdeploy_owner_close_job', { ...payload, p_reason: textValue(body.reason, 'Reason') }));
        if (body.action === 'approve') return json(await rpc('appdeploy_owner_approve_job_for_billing', { ...payload, p_notes: null }));
        if (body.action === 'return') return json(await rpc('appdeploy_owner_return_job_for_correction', { ...payload, p_reason: textValue(body.reason, 'Return reason', true) }));
        fail('Owner Review action must be approve or return.');
      }
      fail('COS endpoint not found.', 404);
    } catch (cause) {
      const status = cause instanceof PrivateEvidenceError ? cause.statusCode : cause instanceof SheetsConnectionError || cause instanceof OperationalMoveError || cause instanceof UnitTrackerError || cause instanceof OwnerIdentityError || cause instanceof HttpError || cause instanceof InhandPilotError || cause instanceof MhelpImportError || cause instanceof MhelpPartnerError || cause instanceof MhelpTicketError ? cause.status : 503;
      return json({ error: cause instanceof PrivateEvidenceError || cause instanceof SheetsConnectionError || cause instanceof OperationalMoveError || cause instanceof UnitTrackerError || cause instanceof OwnerIdentityError || cause instanceof HttpError || cause instanceof InhandPilotError || cause instanceof MhelpImportError || cause instanceof MhelpPartnerError || cause instanceof MhelpTicketError ? cause.message : 'COS Operations is unavailable. Please retry.' }, status);
    } finally {
      if (!responseOwnsPermit) releaseLargeBody();
    }
  };
}
