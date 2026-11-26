// cos-vendor-request v3: the code is main at merge of PR #553 (account number on the unit, Waiting on vendor), pinned by commit.
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createVendorHandler} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/50059947cb66bcef1164a2a2d6da502e7b0d4728/tech-checks/supabase/functions/cos-vendor-request/index.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const options = {auth: {persistSession: false, autoRefreshToken: false}};
Deno.serve(createVendorHandler({
  admin: createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options),
  userClient: createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options),
  env: (name: string) => Deno.env.get(name),
}));
