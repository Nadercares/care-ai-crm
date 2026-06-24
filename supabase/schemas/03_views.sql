--
-- Views
-- This file declares all views in the public schema.
--

create or replace view public.activity_log with (security_invoker = on) as
select
    ('company.' || c.id || '.created') as id,
    'company.created' as type,
    c.created_at as date,
    c.id as company_id,
    c.sales_id,
    to_json(c.*) as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from public.companies c
union all
select
    ('contact.' || co.id || '.created') as id,
    'contact.created' as type,
    co.first_seen as date,
    co.company_id,
    co.sales_id,
    null::json as company,
    to_json(co.*) as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from public.contacts co
union all
select
    ('contactNote.' || cn.id || '.created') as id,
    'contactNote.created' as type,
    cn.date,
    co.company_id,
    cn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    to_json(cn.*) as contact_note,
    null::json as deal_note
from public.contact_notes cn
    left join public.contacts co on co.id = cn.contact_id
union all
select
    ('deal.' || d.id || '.created') as id,
    'deal.created' as type,
    d.created_at as date,
    d.company_id,
    d.sales_id,
    null::json as company,
    null::json as contact,
    to_json(d.*) as deal,
    null::json as contact_note,
    null::json as deal_note
from public.deals d
union all
select
    ('dealNote.' || dn.id || '.created') as id,
    'dealNote.created' as type,
    dn.date,
    d.company_id,
    dn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    to_json(dn.*) as deal_note
from public.deal_notes dn
    left join public.deals d on d.id = dn.deal_id;

create or replace view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;

create or replace view public.contacts_summary with (security_invoker = on) as
select
    co.id,
    co.first_name,
    co.last_name,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.email_jsonb,
    co.phone_jsonb,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;

create or replace view public.init_state with (security_invoker = off) as
select count(sub.id) as is_initialized
from (
    select sales.id from public.sales limit 1
) sub;

create or replace view public.claims_summary with (security_invoker = on) as
select
    cl.id,
    cl.created_at,
    cl.updated_at,
    cl.contact_id,
    cl.policy_id,
    cl.carrier_id,
    cl.carrier_adjuster_id,
    cl.deal_id,
    cl.claim_number,
    cl.internal_claim_number,
    cl.date_of_loss,
    cl.date_reported,
    cl.type_of_loss,
    cl.cause_of_loss,
    cl.loss_location_address,
    cl.loss_location_city,
    cl.loss_location_state,
    cl.loss_location_zip,
    cl.status,
    cl.description,
    cl.assigned_pa_sales_id,
    cl.sales_id,
    co.first_name as insured_first_name,
    co.last_name as insured_last_name,
    car.name as carrier_name,
    car.naic_code as carrier_naic,
    (ca.first_name || ' ' || ca.last_name) as carrier_adjuster_name,
    ca.license_number as carrier_adjuster_license,
    p.policy_number,
    p.policy_type,
    s.settlement_amount,
    s.method as settlement_method,
    s.settled_at,
    s.days_to_settle,
    count(distinct e.id) as nb_estimates
from public.claims cl
    left join public.contacts co on co.id = cl.contact_id
    left join public.carriers car on car.id = cl.carrier_id
    left join public.carrier_adjusters ca on ca.id = cl.carrier_adjuster_id
    left join public.policies p on p.id = cl.policy_id
    left join public.settlements s on s.claim_id = cl.id
    left join public.estimates e on e.claim_id = cl.id
group by cl.id, co.first_name, co.last_name, car.name, car.naic_code,
         ca.first_name, ca.last_name, ca.license_number,
         p.policy_number, p.policy_type,
         s.settlement_amount, s.method, s.settled_at, s.days_to_settle;
