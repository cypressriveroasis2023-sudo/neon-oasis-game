// cos-vendor-request v2: the code is main at merge of PR #544 (Eyeforce CIF forms), pinned by commit.
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createVendorHandler} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/05376704dc0bdb4a58618132e20905769da403e1/tech-checks/supabase/functions/cos-vendor-request/index.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const options = {auth: {persistSession: false, autoRefreshToken: false}};
Deno.serve(createVendorHandler({
  admin: createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options),
  userClient: createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options),
  env: (name: string) => Deno.env.get(name),
}));
