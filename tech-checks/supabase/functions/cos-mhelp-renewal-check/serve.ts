// Immutable, already-reviewed shared manager: existing Vault RPC lease, rotation,
// persistence-before-account-verification, and durable vendor cooldown are retained.
import {nativeMhelpTokens} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/559906b9b8af58ff8a4699366175cc28d3085f24/tech-checks/supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts';
import {createRenewalCheck} from './index.ts';
const env=(name:string)=>Deno.env.get(name);
const tokens=nativeMhelpTokens(env);
Deno.serve(createRenewalCheck({env,fetch,renewAccess:tokens.renewAccess}));
