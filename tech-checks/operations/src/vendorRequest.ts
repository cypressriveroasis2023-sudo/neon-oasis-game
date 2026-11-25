// Vendor emails from the unit card (cos-vendor-request, Tech Check). Owner only.
// The server holds the templates and sends; the card only fills the blanks and shows the result.
import {readParentAccessToken} from './cosPowerAlarms';

const URL_ = 'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/cos-vendor-request';
export type VendorField = {key: string; label: string; required: boolean; hint?: string; long?: boolean};
export type VendorTemplate = {title: string; button: string; to: string; fields: VendorField[]; sheet: 'sim' | 'monitoring' | null; defaults: Record<string, string>};
export type VendorMail = {to: string; cc: string; subject: string; body: string};
export type VendorRecent = {kind: string; state: string; by: string; at: string; to: string; subject: string; sheet: string | null; error: string | null};

async function call(body: unknown, fetcher: typeof fetch = fetch): Promise<{status: number; json: any}> {
  const access = await readParentAccessToken();
  if (!access) return {status: 401, json: {error: 'Sign in to COS to continue.'}};
  const response = await fetcher(URL_, {method: 'POST', headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store'});
  let json: any = null;
  try { json = await response.json(); } catch { /* no body */ }
  return {status: response.status, json};
}
const said = (json: any, fallback: string) => (json && typeof json.error === 'string' && json.error) || fallback;

export async function vendorTemplates(): Promise<Record<string, VendorTemplate>> {
  const {status, json} = await call({action: 'templates'});
  if (status !== 200 || !json?.templates) throw Object.assign(new Error(said(json, 'Vendor emails are not available right now.')), {denied: status === 401 || status === 403});
  return json.templates;
}
export async function vendorPreview(kind: string, values: Record<string, string>): Promise<{mail?: VendorMail; missing?: string[]}> {
  const {status, json} = await call({action: 'preview', kind, values});
  if (status !== 200) throw new Error(said(json, 'The email could not be prepared.'));
  return json.ok ? {mail: json.mail} : {missing: Array.isArray(json.missing) ? json.missing : ['Something is missing.']};
}
export async function vendorSend(kind: string, values: Record<string, string>, requestId: string): Promise<{state: string; sheet: string; error: string}> {
  const {status, json} = await call({action: 'send', kind, values, request_id: requestId});
  if (status !== 200) throw new Error(said(json, 'The email could not be sent.'));
  if (Array.isArray(json?.missing)) throw new Error('Fill in: ' + json.missing.join(', '));
  return {state: String(json?.state || 'failed'), sheet: String(json?.sheet || ''), error: String(json?.error || '')};
}
export async function vendorRecent(unit: string): Promise<VendorRecent[]> {
  const {status, json} = await call({action: 'recent', unit});
  return status === 200 && Array.isArray(json?.recent) ? json.recent.slice(0, 10) : [];
}
export type VendorCheck = {account_ok: boolean; can_send?: boolean; can_edit_sheets?: boolean; sheet_opens?: boolean; error?: string};
export async function vendorCheck(): Promise<VendorCheck> {
  const {status, json} = await call({action: 'check'});
  return status === 200 && json ? json : {account_ok: false, error: said(json, 'The Google connection could not be checked.')};
}
