-- Phase 12: pattern analytics views.
-- Two aggregations that answer the original user request: "see different
-- practices and patterns from the insurance companies / track carrier
-- adjusters by name, license, settlement amounts, settlement method,
-- attorney involvement, mediation method".
--
-- Both views run with security_invoker = on so RLS on the underlying
-- tables (claims / settlements / etc.) applies to anyone querying.

create or replace view public.carrier_patterns_summary
with (security_invoker = on)
as
select
    c.id                                                                            as carrier_id,
    c.name                                                                          as carrier_name,
    c.naic_code,
    c.default_state,
    count(distinct cl.id)                                                           as claim_count,
    count(distinct cl.id) filter (where s.id is not null)                            as settled_count,
    coalesce(sum(s.settlement_amount), 0)::numeric(14, 2)                            as total_settled_amount,
    avg(s.settlement_amount)::numeric(12, 2)                                         as avg_settlement_amount,
    avg(s.days_to_settle)::numeric(6, 1)                                             as avg_days_to_settle,
    count(s.id) filter (where s.method = 'negotiation')                              as count_negotiation,
    count(s.id) filter (where s.method = 'appraisal')                                as count_appraisal,
    count(s.id) filter (where s.method = 'mediation')                                as count_mediation,
    count(s.id) filter (where s.method = 'litigation')                               as count_litigation,
    count(s.id) filter (where s.method = 'denied')                                   as count_denied,
    count(s.id) filter (where s.method = 'withdrawn')                                as count_withdrawn,
    count(s.id) filter (where s.attorney_involved)                                   as count_with_attorney,
    count(s.id) filter (
        where s.method in ('appraisal', 'mediation', 'litigation')
    )                                                                                as count_escalated,
    max(s.settled_at)                                                                as last_settlement_at
from public.carriers c
left join public.claims cl on cl.carrier_id = c.id
left join public.settlements s on s.claim_id = cl.id
group by c.id, c.name, c.naic_code, c.default_state;

create or replace view public.adjuster_patterns_summary
with (security_invoker = on)
as
select
    ca.id                                                           as carrier_adjuster_id,
    ca.first_name,
    ca.last_name,
    coalesce(nullif(trim(ca.first_name || ' ' || ca.last_name), ''), 'Unnamed') as adjuster_name,
    ca.license_number,
    ca.license_state,
    ca.role,
    ca.email,
    ca.phone,
    ca.carrier_id,
    car.name                                                        as carrier_name,
    count(distinct cl.id)                                            as claim_count,
    count(distinct cl.id) filter (where s.id is not null)            as settled_count,
    coalesce(sum(s.settlement_amount), 0)::numeric(14, 2)            as total_settled_amount,
    avg(s.settlement_amount)::numeric(12, 2)                         as avg_settlement_amount,
    avg(s.days_to_settle)::numeric(6, 1)                             as avg_days_to_settle,
    count(s.id) filter (where s.attorney_involved)                   as count_with_attorney,
    count(s.id) filter (
        where s.method in ('appraisal', 'mediation', 'litigation')
    )                                                                as count_escalated,
    count(s.id) filter (where s.method = 'negotiation')              as count_negotiation,
    count(s.id) filter (where s.method = 'appraisal')                as count_appraisal,
    count(s.id) filter (where s.method = 'mediation')                as count_mediation,
    count(s.id) filter (where s.method = 'litigation')               as count_litigation,
    count(s.id) filter (where s.method = 'denied')                   as count_denied,
    max(s.settled_at)                                                as last_settlement_at
from public.carrier_adjusters ca
left join public.carriers car on car.id = ca.carrier_id
left join public.claims cl on cl.carrier_adjuster_id = ca.id
left join public.settlements s on s.claim_id = cl.id
group by
    ca.id, ca.first_name, ca.last_name, ca.license_number,
    ca.license_state, ca.role, ca.email, ca.phone, ca.carrier_id, car.name;
