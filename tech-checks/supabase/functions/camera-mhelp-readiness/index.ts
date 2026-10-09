import {reply,readAction} from '../cos-mhelp-readiness/index.ts';
const TARGET = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-mhelp-readiness';
export function createCameraMhelpReadinessHandler(options: {verifyCron:(candidate:string|null)=>Promise<boolean>;readKey:()=>string|undefined;fetch:typeof fetch}) {
  return async (req:Request) => {
    try { if (!await options.verifyCron(req.headers.get('x-camera-cron-secret'))) return reply({error:'Forbidden'},403); }
    catch { return reply({error:'Forbidden'},403); }
    let action: 'status'|'preview'; try { action=await readAction(req); } catch { return reply({error:'Invalid readiness request'},400); }
    const key=options.readKey(); if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) return reply({error:'Existing source-read connection is unavailable'},503);
    try {
      const response=await options.fetch(TARGET,{method:'POST',headers:{'Content-Type':'application/json','x-cos-mhelp-read-key':key},body:JSON.stringify({action}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
      const raw=await response.text(); if (new TextEncoder().encode(raw).byteLength>16384 || raw.includes(key)) throw Error('Unsupported response');
      const v=JSON.parse(raw);
      if (!response.ok) {
        const errors = new Set(['Forbidden','mHelpDesk needs a server-held access token before previewing equipment.','The saved mHelpDesk portal ID must be a numeric company ID. Correct or remove that setting before previewing equipment.','mHelpDesk denied API access. Verify the token, portal, and Partner API approval.','mHelpDesk is limiting requests. Wait before retrying.','mHelpDesk could not be reached. Retry the preview.']);
        return reply({error:errors.has(v?.error)?v.error:'The mHelpDesk account or equipment read could not be verified'},response.status===429?429:503);
      }
      const allowed=['contract','state','tokenConfigured','portalConfigured','liveAccessVerified','automaticSync','verifiedPortalId','totalRows','partial','previewCount','identities'];
      if (!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).some(k=>!allowed.includes(k)) || v.contract!=='cos-mhelpdesk-partner-review-v1' || typeof v.tokenConfigured!=='boolean' || typeof v.portalConfigured!=='boolean' || typeof v.liveAccessVerified!=='boolean' || v.automaticSync!==false) throw Error('Unsupported response');
      return reply(v);
    } catch { return reply({error:'mHelpDesk readiness is unavailable'},503); }
  };
}
