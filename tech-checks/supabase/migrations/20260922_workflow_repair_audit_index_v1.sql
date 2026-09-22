create index if not exists workflow_repair_audit_repaired_by_idx
on public.workflow_repair_audit(repaired_by);

create index if not exists workflow_repair_audit_ticket_created_idx
on public.workflow_repair_audit(ticket_no,created_at desc);
