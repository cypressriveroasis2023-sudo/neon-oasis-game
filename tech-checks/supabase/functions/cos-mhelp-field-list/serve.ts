import {createMhelpFieldListHandler} from './index.ts';
const NATIVE = 'https://tughscoxralhofrckvxy.supabase.co';
const READINESS = 'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness';
async function json(response: Response, max = 4194304) {
 if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) throw Error('Read unavailable');
 const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
 let raw = '', bytes = 0;
 try {
  for (;;) {
   const r = await reader.read(); if (r.done) break;
   bytes += r.value.length; if (bytes > max) throw Error('Read unavailable');
   raw += decoder.decode(r.value, {stream: true});
  }
  return JSON.parse(raw + decoder.decode());
 } finally { void reader.cancel().catch(() => {}); }
}
// The same scheduled-caller check the inventory sync uses: the secret is proven
// by the Tech Check project, which holds it. This function never sees its value
// beyond passing the header straight through.
async function authenticate(req: Request) {
 if (Deno.env.get('SUPABASE_URL') !== NATIVE) return false;
 const secret = req.headers.get('x-camera-cron-secret');
 if (!secret || secret.length > 1024 || /\s/.test(secret)) return false;
 const v = await json(await fetch(READINESS, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret},
  body: '{"action":"authenticate"}', redirect: 'error', signal: AbortSignal.timeout(10000),
 }), 128);
 return v?.authenticated === true && Object.keys(v).length === 1;
}
// The accepted baseline the inventory sync already maintains. Read only.
async function readBaseline() {
 const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if (!key || Deno.env.get('SUPABASE_URL') !== NATIVE) throw Error('Backend unavailable');
 return json(await fetch(NATIVE + '/rest/v1/rpc/cos_mhelp_inventory_baseline', {
  method: 'POST',
  headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
  body: '{}', redirect: 'error', signal: AbortSignal.timeout(20000),
 }), 4194304);
}
Deno.serve(createMhelpFieldListHandler({authenticate, readBaseline}));
