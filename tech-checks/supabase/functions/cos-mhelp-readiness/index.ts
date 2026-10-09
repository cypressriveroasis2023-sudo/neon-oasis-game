import {MhelpPartnerError, MHELP_PARTNER_CONTRACT} from '../cos-operations-pages/mhelpPartner.ts';
type Row = Record<string, any>;
export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
export function validReadKey(expected: unknown, supplied: unknown): boolean {
  if (typeof expected !== 'string' || typeof supplied !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expected) || !/^[a-fA-F0-9]{64}$/.test(supplied)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.toLowerCase().charCodeAt(i) ^ supplied.toLowerCase().charCodeAt(i);
  return difference === 0;
}
export async function readAction(req: Request): Promise<'status'|'preview'> {
  if (req.method !== 'POST' || new URL(req.url).search || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) throw Error('Invalid request');
  const reader = req.body?.getReader(); if (!reader) throw Error('Invalid request');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) throw Error('Invalid request'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c,offset); offset += c.byteLength; }
  const v = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !['status','preview'].includes(v.action)) throw Error('Invalid request');
  return v.action;
}
export function projectReadiness(v: Row): Row {
  if (!v || v.contract !== MHELP_PARTNER_CONTRACT || !['setup_required','ready_to_test','preview_verified'].includes(v.state) || typeof v.tokenConfigured !== 'boolean' || typeof v.portalConfigured !== 'boolean' || typeof v.liveAccessVerified !== 'boolean') throw Error('Unsupported readiness');
  const result: Row = {contract:MHELP_PARTNER_CONTRACT,state:v.state,tokenConfigured:v.tokenConfigured,portalConfigured:v.portalConfigured,liveAccessVerified:v.liveAccessVerified,automaticSync:false};
  if (v.liveAccessVerified) {
    if (typeof v.verifiedPortalId !== 'string' || !/^[1-9]\d{0,14}$/.test(v.verifiedPortalId) || !Number.isSafeInteger(v.totalRows) || v.totalRows < 0 || typeof v.partial !== 'boolean') throw Error('Unsupported readiness');
    const items = Array.isArray(v.items) ? v.items : null;
    if (!items || items.length > 50) throw Error('Unsupported readiness');
    const identities = {verified_link:0,review_needed:0,ambiguous:0,identity_changed:0};
    for (const item of items) { const state = item?.identity?.state; if (!Object.hasOwn(identities,state)) throw Error('Unsupported readiness'); identities[state as keyof typeof identities]++; }
    Object.assign(result,{verifiedPortalId:v.verifiedPortalId,totalRows:v.totalRows,partial:v.partial,previewCount:items.length,identities});
  }
  return result;
}
export function createMhelpReadinessHandler(options: {authenticate:(req:Request)=>boolean; partner:(path:string,method:string,body:unknown)=>Promise<Row>}) {
  return async (req: Request) => {
    if (!options.authenticate(req)) return reply({error:'Forbidden'},403);
    let action: 'status'|'preview'; try { action = await readAction(req); } catch { return reply({error:'Invalid readiness request'},400); }
    try { return reply(projectReadiness(await options.partner('/api/mhelpdesk/partner/'+action, action === 'status' ? 'GET':'POST',{}))); }
    catch (e) { return reply({error:e instanceof MhelpPartnerError ? e.message:'mHelpDesk readiness is unavailable'},e instanceof MhelpPartnerError ? e.status:503); }
  };
}
