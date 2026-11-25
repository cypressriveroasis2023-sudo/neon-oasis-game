# 2026-11-25 — COS unit card: Email a vendor

Project: Tech Check `goqrnolcvqnirjmzaeyk`. Asked for by James on 2026-11-25.

- Table `app_private.vendor_requests` (every request: kind, unit, values, the exact email, who, state, Gmail id, sheet result).
- Functions (service_role only): `public.cos_vendor_actor_v1`, `cos_vendor_claim_v1` (one send per request id),
  `cos_vendor_finish_v1`, `cos_vendor_recent_v1`. File: `tech-checks/database-maintenance/cos-vendor-requests-v1.sql`.
- New edge function `cos-vendor-request` (v1, deployed from this branch's `tech-checks/supabase/functions/cos-vendor-request/`).
  Owner only. Templates: SIM cancel to support@vendera.freshdesk.com or support@simetry.com; add / remove / unit swap
  to techops@eyeforce.com (Stages and Watchful). Sent from James's Gmail (the existing TECHCHECK_GOOGLE_* connection,
  which is jmartin@) with IT@camerasonsite.com in CC. SIM and monitoring cancellations add a row to
  "MONITORING AND SIM CARD DEACTIVATION MODEM SWAP 2026" (Deactivation History) when Google allows it.
- Nothing existing was changed.

Rollback: delete the edge function `cos-vendor-request`; the table and functions can stay (nothing else uses them).
