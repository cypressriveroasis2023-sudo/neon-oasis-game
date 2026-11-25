import {importPKCS8, SignJWT} from 'jose';
import {createDeactivationLog} from './index.ts';
// The caller's secret is checked by Tech Check, which holds it (same boundary as cos-sheets-placement-publish).
Deno.serve(createDeactivationLog({
  getEnv: n => Deno.env.get(n),
  sign: async (key, header, payload) => new SignJWT(payload).setProtectedHeader(header).sign(await importPKCS8(key, 'RS256')),
  verify: async secret => {
    const r = await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness', {method: 'POST', redirect: 'error',
      headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret}, body: '{"action":"authenticate"}', signal: AbortSignal.timeout(10000)});
    const v = await r.json().catch(() => ({}));
    return r.ok && v?.authenticated === true;
  },
}));
