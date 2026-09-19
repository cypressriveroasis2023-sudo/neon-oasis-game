-- Harden direct access to the OnSite Vision action audit ledger.
-- All mutations must go through owner-gated Vision RPCs.

revoke all privileges on table public.vision_action_audit from authenticated;
revoke all privileges on table public.vision_action_audit from anon;
grant select on table public.vision_action_audit to authenticated;
