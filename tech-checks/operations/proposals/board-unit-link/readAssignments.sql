-- PREPARATION ONLY. Read-only query; NOT installed as an RPC or wired to a route.
-- Run only after the EXISTING Board membership/job-view checks succeed.
-- $1 = server-resolved organization UUID, $2 = job UUIDs from that authorized Board.
-- Never accept these parameters as a substitute for authorization.
-- Returns every active primary assignment, including duplicates and inconsistent
-- released rows, so the resolver fails closed rather than guessing the latest.
WITH request AS MATERIALIZED (
  SELECT $1::uuid AS organization_id, $2::uuid[] AS job_ids
), scope AS MATERIALIZED (
  SELECT r.*,
    r.organization_id IS NOT NULL AND r.job_ids IS NOT NULL
    AND cardinality(r.job_ids) BETWEEN 0 AND 500
    AND NOT EXISTS (SELECT 1 FROM unnest(r.job_ids) x WHERE x IS NULL)
    AND cardinality(r.job_ids)=(SELECT count(DISTINCT x) FROM unnest(r.job_ids) x)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(r.job_ids) x
      WHERE NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=x AND j.organization_id=r.organization_id)
    ) AS valid
  FROM request r
), selected AS MATERIALIZED (
  SELECT j.id AS job_id, a.id AS assignment_id, a.equipment_unit_id,
    a.assignment_type, a.status, a.assigned_at, a.released_at,
    u.organization_id=s.organization_id AS same_organization,
    u.status AS unit_status, u.retired_at
  FROM scope s
  JOIN public.jobs j ON s.valid AND j.organization_id=s.organization_id AND j.id=ANY(s.job_ids)
  JOIN public.equipment_assignments a ON a.job_id=j.id
    AND a.assignment_type='primary_job_unit' AND a.status='active'
  LEFT JOIN public.equipment_units u ON u.id=a.equipment_unit_id
), bounded AS (
  SELECT count(*) AS n FROM selected
)
SELECT jsonb_build_object(
  'contract','COS_BOARD_ASSIGNMENTS_V1',
  'organizationId',s.organization_id,
  'asOf',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'complete',coalesce(s.valid,false) AND b.n<=2000,
  'jobIds',CASE WHEN s.valid AND b.n<=2000 THEN to_jsonb(s.job_ids) ELSE '[]'::jsonb END,
  'items',CASE WHEN s.valid AND b.n<=2000 THEN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'assignmentId',a.assignment_id,'jobId',a.job_id,
      'unitId',CASE WHEN a.same_organization THEN a.equipment_unit_id ELSE NULL END,
      'sameOrganization',coalesce(a.same_organization,false),
      'assignmentType',a.assignment_type,'status',a.status,
      'assignedAt',to_char(a.assigned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'releasedAt',to_char(a.released_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unitStatus',CASE WHEN a.same_organization THEN a.unit_status ELSE NULL END,
      'retiredAt',CASE WHEN a.same_organization THEN to_char(a.retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE NULL END
    ) ORDER BY a.job_id,a.assignment_id) FROM selected a
  ),'[]'::jsonb) ELSE '[]'::jsonb END
) AS snapshot
FROM scope s CROSS JOIN bounded b;
-- readState is intentionally absent: the existing caller must supply its own
-- current/stale/unavailable decision. This query never declares freshness.
