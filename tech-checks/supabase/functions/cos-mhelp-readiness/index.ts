import {MhelpPartnerError, MHELP_PARTNER_CONTRACT} from '../cos-operations-pages/mhelpPartner.ts';
type Row = Record<string, any>;
/** Constructed only by the trusted ticket adapter; never from a vendor error body. */
export class TicketReadinessError extends Error {
  constructor(message:string, public status:number, public provider?:{operation:'account_read'|'ticket_read'|'ticket_types_read'|'ticket_statuses_read';httpStatus:number}) { super(message); }
}
export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
type ReadinessRequest = {action:'status'|'preview'|'full_review'|'renew_access'} | {action:'ticket_preview';createdAfter:string;createdBefore:string};
export async function readAction(req: Request): Promise<ReadinessRequest> {
  if (req.method !== 'POST' || new URL(req.url).search || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) throw Error('Invalid request');
  const reader = req.body?.getReader(); if (!reader) throw Error('Invalid request');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) throw Error('Invalid request'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c,offset); offset += c.byteLength; }
  const v = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid request');
  if (v.action === 'ticket_preview') {
    if (Object.keys(v).length !== 3 || Object.keys(v).some(k => !['action','createdAfter','createdBefore'].includes(k))) throw Error('Invalid request');
    const timestamp = (x:unknown) => typeof x === 'string' && x.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,19) === x.slice(0,19);
    if (!timestamp(v.createdAfter) || !timestamp(v.createdBefore)) throw Error('Invalid request');
    const duration = Date.parse(v.createdBefore) - Date.parse(v.createdAfter);
    if (duration <= 0 || duration > 31 * 86400000) throw Error('Invalid request');
    return {action:'ticket_preview',createdAfter:v.createdAfter,createdBefore:v.createdBefore};
  }
  if (Object.keys(v).length !== 1 || !['status','preview','full_review','renew_access'].includes(v.action)) throw Error('Invalid request');
  return {action:v.action};
}
export function projectReadiness(v: Row, fullReview=false): Row {
  if (!v || v.contract !== MHELP_PARTNER_CONTRACT || !['setup_required','ready_to_test','preview_verified'].includes(v.state) || typeof v.tokenConfigured !== 'boolean' || typeof v.portalConfigured !== 'boolean' || typeof v.liveAccessVerified !== 'boolean') throw Error('Unsupported readiness');
  const result: Row = {contract:MHELP_PARTNER_CONTRACT,state:v.state,tokenConfigured:v.tokenConfigured,portalConfigured:v.portalConfigured,liveAccessVerified:v.liveAccessVerified,automaticSync:false};
  if (v.liveAccessVerified) {
    if (typeof v.verifiedPortalId !== 'string' || !/^[1-9]\d{0,14}$/.test(v.verifiedPortalId) || !Number.isSafeInteger(v.totalRows) || v.totalRows < 0 || typeof v.partial !== 'boolean') throw Error('Unsupported readiness');
    const items = Array.isArray(v.items) ? v.items : null;
    if (!items || items.length > (fullReview ? 10000 : 50) || (fullReview && (v.partial || items.length!==v.totalRows))) throw Error('Unsupported readiness');
    const identities = {verified_link:0,review_needed:0,ambiguous:0,identity_changed:0};
    const labelCandidates={none:0,single:0,multiple:0};
    for (const item of items) { const state = item?.identity?.state; if (!Object.hasOwn(identities,state)) throw Error('Unsupported readiness'); identities[state as keyof typeof identities]++;
      const candidates=item?.identity?.candidateUnitIds;
      if (Array.isArray(candidates)) labelCandidates[candidates.length===0?'none':candidates.length===1?'single':'multiple']++;
    }
    Object.assign(result,{verifiedPortalId:v.verifiedPortalId,totalRows:v.totalRows,partial:v.partial,previewCount:items.length,identities,labelCandidates,...(fullReview?{fullReview:true}:{})});
  }
  return result;
}
export function createMhelpReadinessHandler(options: {authenticate:(req:Request)=>Promise<boolean>|boolean; partner:(path:string,method:string,body:unknown)=>Promise<Row>; fullReview?:()=>Promise<Row>; renewAccess?:()=>Promise<unknown>; ticketPreview?:(window:{createdAfter:string;createdBefore:string})=>Promise<Row>; renewalConfiguration?:()=>{refreshTokenConfigured:boolean;clientIdConfigured:boolean;clientSecretConfigured:boolean}}) {
  return async (req: Request) => {
    try { if (!await options.authenticate(req)) return reply({error:'Forbidden'},403); }
    catch { return reply({error:'Forbidden'},403); }
    let input: ReadinessRequest; try { input = await readAction(req); } catch { return reply({error:'Invalid readiness request'},400); }
    try {
      if (input.action === 'ticket_preview') {
        if (!options.ticketPreview) return reply({error:'Ticket preview unavailable'},503);
        // The callback is a trusted aggregate-only projector. No ticket payload is returned.
        return reply(await options.ticketPreview({createdAfter:input.createdAfter,createdBefore:input.createdBefore}));
      }
      const action = input.action;
      if (action==='full_review' && !options.fullReview) return reply({error:'Full review unavailable'},503);
      if (action==='renew_access') { if(!options.renewAccess)return reply({error:'Token renewal unavailable'},503);await options.renewAccess(); }
      const projected=projectReadiness(action==='full_review' ? await options.fullReview!() : await options.partner('/api/mhelpdesk/partner/'+(action==='renew_access'?'preview':action), action === 'status' ? 'GET':'POST',{}),action==='full_review');
      if(action==='renew_access')projected.tokenRenewalVerified=true;
      if(options.renewalConfiguration) {
        const v=options.renewalConfiguration();
        projected.renewalConfiguration={refreshTokenConfigured:v.refreshTokenConfigured===true,clientIdConfigured:v.clientIdConfigured===true,clientSecretConfigured:v.clientSecretConfigured===true};
      }
      return reply(projected);
    }
    catch (e) {
      const known=e instanceof MhelpPartnerError || e instanceof TicketReadinessError;
      const provider=known && e.provider && ['account_read','equipment_read','ticket_read','ticket_types_read','ticket_statuses_read'].includes(e.provider.operation) && Number.isInteger(e.provider.httpStatus) && e.provider.httpStatus>=100 && e.provider.httpStatus<=599 ? {operation:e.provider.operation,httpStatus:e.provider.httpStatus}:null;
      return reply({error:known ? e.message:'mHelpDesk readiness is unavailable',...(provider?{provider}: {})},known ? e.status:503);
    }
  };
}
