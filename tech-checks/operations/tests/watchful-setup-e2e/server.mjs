// End-to-end harness for the Watchful setup check: serves the real Tech Check files and answers the
// screens' database calls from an in-memory Postgres (PGlite) loaded with the real change file.
// The page gets a fake Supabase client whose rpc() and storage calls come here.
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

const root = fileURLToPath(new URL('../../../', import.meta.url));   // tech-checks/
const change = readFileSync(join(root, 'database-maintenance/watchful-setup-check-v1.sql'), 'utf8');
export const PEOPLE = {
  josh: '00000000-0000-4000-8000-0000000000a1', teddy: '00000000-0000-4000-8000-0000000000b1', james: '00000000-0000-4000-8000-0000000000c1'};
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json'};

export async function start(port = 0) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean default true, archived_at timestamptz, full_name text, username text);
    create table public.camera_devices(id bigserial primary key, unit_key text, device_name text, device_type text, device_model text,
      tech_check_unit_type text, do_not_use boolean default false, activation_state text);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    alter table storage.objects enable row level security;
    insert into public.profiles(user_id, role, full_name) values
      ('${PEOPLE.josh}','service','Josh Rivera'), ('${PEOPLE.teddy}','it','Teddy'), ('${PEOPLE.james}','owner','James Martin');
    insert into public.camera_devices(unit_key, device_name, device_type, device_model, tech_check_unit_type) values
      ('SPOTTER 236','Spotter 236HD','NVR','ALI-NR040F-1','NVR'),
      ('HELIOS 005','Helios 005 - Cam 001','IPC','ALI-PB50-LUAIS-D','Helios'), ('HELIOS 005','Helios 005 - Cam 002','IPC','ALI-PB50-LUAIS-D','Helios'),
      ('HELIOS 005','Helios 005 - Cam 003','IPC','ALI-PZ40-UZAI-D','Helios'),
      ('SOLARSPOTTER 029','SolarSpotter 029_1','IPC','ALI-FB81-LUA-D','Solar Spotter');
  `);
  await db.exec(change);
  const files = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, {'content-type': type, 'cache-control': 'no-store'}); res.end(body); };
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
        const name = url.pathname.slice(5); if (!/^ws_[a-z_0-9]+$/.test(name)) return send(400, '{"message":"bad"}');
        const args = JSON.parse(await body(req) || '{}'), keys = Object.keys(args);
        await db.query("select set_config('test.actor', $1, false)", [req.headers['x-actor'] || '']);
        const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
        const vals = keys.map(k => args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k])
          : Array.isArray(args[k]) && args[k].some(x => x && typeof x === 'object') ? JSON.stringify(args[k]) : args[k]);
        try { const r = await db.query(sql, vals); return send(200, JSON.stringify({data: r.rows[0]?.v ?? null})); }
        catch (e) { return send(200, JSON.stringify({error: {message: e.message}})); }
      }
      if (req.method === 'POST' && url.pathname === '/upload') {
        const path = url.searchParams.get('path'), bytes = await raw(req);
        await db.query("select set_config('test.actor', $1, false)", [req.headers['x-actor'] || '']);
        const ok = (await db.query("select app_private.ws_file_ok($1, true) ok", [path])).rows[0].ok;
        if (!ok) return send(200, JSON.stringify({error: {message: 'new row violates row-level security policy', statusCode: '403'}}));
        if (files.has(path)) return send(200, JSON.stringify({error: {message: 'The resource already exists', statusCode: '409'}}));
        files.set(path, bytes);
        await db.query("insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', $1, $2)", [path, JSON.stringify({size: bytes.length})]);
        return send(200, '{"data":{}}');
      }
      if (url.pathname === '/object') { const b = files.get(url.searchParams.get('path')); return b ? send(200, b, 'image/jpeg') : send(404, ''); }
      if (url.pathname === '/' || url.pathname === '/harness.html') return send(200, readFileSync(new URL('./harness.html', import.meta.url)), 'text/html');
      const file = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(root) || !existsSync(file)) return send(404, 'not found', 'text/plain');
      return send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
    } catch (e) { send(500, JSON.stringify({error: {message: e.message}})); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return {db, url: 'http://127.0.0.1:' + server.address().port, close: async () => { server.close(); await db.close(); }};
}
const raw = req => new Promise((ok, no) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const body = async req => (await raw(req)).toString('utf8');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start(Number(process.env.PORT || 4180));
  console.log('Watchful setup harness on ' + s.url + '/?as=josh');
}
