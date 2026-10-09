-- Read-only diagnostic receipt. No addresses, source bindings or provider bodies.
-- Request IDs link each result to exactly one claimed attempt; before-images stay immutable.
with members as (
 select a.diagnostic_recovery_v1->>'manifestSha256' manifest_sha256,e.key address_sha256,e.value d
 from app_private.cos_geocodio_account_state a,
 lateral jsonb_each(coalesce(a.diagnostic_recovery_v1->'jobs','{}'::jsonb)) e where a.singleton
)
select m.manifest_sha256,m.address_sha256,
 (m.d#>>'{censusBefore,updated_at}')::timestamptz census_historical_at,
 (m.d#>>'{fallbackBefore,updated_at}')::timestamptz geocodio_historical_at,
 exists(select 1 from app_private.cos_imported_geocode_jobs j
  where j.binding=m.d->'binding' and not j.invalidated) queue_binding_current,
 m.d->>'censusRequestId' census_request_id,c.reserved_at census_reserved_at,c.completed_at census_completed_at,
 case when c.request_id is null then 'unspent'
  when c.completed_at is null and c.lease_until<=clock_timestamp() then 'expired_unsettled'
  when c.completed_at is null then 'in_flight' else coalesce(c.outcome->>'status',c.outcome->>'reason') end census_outcome,
 c.outcome->>'reason' census_reason,
 m.d->>'geocodioRequestId' geocodio_request_id,g.budget_day charged_day,g.reserved_at geocodio_reserved_at,g.completed_at geocodio_completed_at,
 case when g.request_id is null then 'unspent'
  when g.completed_at is null and g.lease_until<=clock_timestamp() then 'expired_unsettled'
  when g.completed_at is null then 'in_flight' else coalesce(g.outcome->>'status',g.outcome->>'reason') end geocodio_outcome,
 g.outcome->>'reason' geocodio_reason
from members m
left join app_private.cos_imported_census_requests c on c.request_id=(m.d->>'censusRequestId')::uuid
left join app_private.cos_geocodio_reservations g on g.request_id=(m.d->>'geocodioRequestId')::uuid
order by m.address_sha256;
