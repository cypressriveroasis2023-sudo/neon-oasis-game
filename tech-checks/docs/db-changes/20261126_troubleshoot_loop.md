# 2026-11-26 — Send to IT, closing the loop (Operations functions)

Project: Operations `tughscoxralhofrckvxy`
Source: `tech-checks/operations/db/20261126_troubleshoot_loop.sql` (applied by hand 2026-11-26 ~15:40 UTC)

James said "Proceed" on the loop: every Send to IT report shows **Open** on the
unit card until someone closes it as **Fixed** or **Not needed** with a note.

- `cos_troubleshoot_private.report_closures` (one closing row per report; reports
  stay append-only and are never changed).
- `public.cos_troubleshoot_open_v1(actor, org)`: open reports plus those closed
  in the last 7 days. `public.cos_troubleshoot_close_v1(actor, org, id, payload)`:
  close one with outcome and note; refuses a blank note or a full IP address;
  a second close returns the first. Both service_role only, actor checked by
  `app_private.cos_owner_identity_assert_actor` like `cos_troubleshoot_report_v1`.
- Tested in a rolled-back run: report → open → close → closed.

No Tech Check change, no audit row. At apply time there were 0 reports.

The Operations side ships as recorded patch
`cos-unit-camera-status/send-to-it-loop-v24` (from live v24 `45576950`),
rollback `rollback-to-v24-entry`.

Rollback:

```sql
drop function if exists public.cos_troubleshoot_close_v1(uuid, uuid, uuid, jsonb);
drop function if exists public.cos_troubleshoot_open_v1(uuid, uuid);
```
