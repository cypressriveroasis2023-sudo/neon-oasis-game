import {reply} from '../cos-mhelp-readiness/index.ts';
/** Credential introspection only; the original project keeps its cron credential. */
export function createCameraMhelpReadinessHandler(options: {verifyCron:(candidate:string|null)=>Promise<boolean>}) {
  return async (req:Request) => {
    try { if (!await options.verifyCron(req.headers.get('x-camera-cron-secret'))) return reply({error:'Forbidden'},403); }
    catch { return reply({error:'Forbidden'},403); }
    if (req.method!=='POST' || new URL(req.url).search || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||'')) return reply({error:'Invalid readiness request'},400);
    try {
      const raw=await req.text(); if (raw.length>256) throw Error('Invalid request');
      const v=JSON.parse(raw);
      if (!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).length!==1 || v.action!=='authenticate') throw Error('Invalid request');
      return reply({authenticated:true});
    } catch { return reply({error:'Invalid readiness request'},400); }
  };
}
