--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.sales enable row level security;
alter table public.tags enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;
alter table public.favicons_excluded_domains enable row level security;

-- Companies
create policy "Enable read access for authenticated users" on public.companies for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.companies for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.companies for update to authenticated using (true) with check (true);
create policy "Company Delete Policy" on public.companies for delete to authenticated using (true);

-- Contacts
create policy "Enable read access for authenticated users" on public.contacts for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contacts for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.contacts for update to authenticated using (true) with check (true);
create policy "Contact Delete Policy" on public.contacts for delete to authenticated using (true);

-- Contact Notes
create policy "Enable read access for authenticated users" on public.contact_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contact_notes for insert to authenticated with check (true);
create policy "Contact Notes Update policy" on public.contact_notes for update to authenticated using (true);
create policy "Contact Notes Delete Policy" on public.contact_notes for delete to authenticated using (true);

-- Deals
create policy "Enable read access for authenticated users" on public.deals for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deals for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.deals for update to authenticated using (true) with check (true);
create policy "Deals Delete Policy" on public.deals for delete to authenticated using (true);

-- Deal Notes
create policy "Enable read access for authenticated users" on public.deal_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deal_notes for insert to authenticated with check (true);
create policy "Deal Notes Update Policy" on public.deal_notes for update to authenticated using (true);
create policy "Deal Notes Delete Policy" on public.deal_notes for delete to authenticated using (true);

-- Sales
create policy "Enable read access for authenticated users" on public.sales for select to authenticated using (true);

-- Tags
create policy "Enable read access for authenticated users" on public.tags for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tags for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.tags for update to authenticated using (true);
create policy "Enable delete for authenticated users only" on public.tags for delete to authenticated using (true);

-- Tasks
create policy "Enable read access for authenticated users" on public.tasks for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tasks for insert to authenticated with check (true);
create policy "Task Update Policy" on public.tasks for update to authenticated using (true);
create policy "Task Delete Policy" on public.tasks for delete to authenticated using (true);

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Favicons excluded domains
create policy "Enable access for authenticated users only" on public.favicons_excluded_domains to authenticated using (true) with check (true);

-- Claims domain RLS (authenticated users have full access; refine later if/when client/contractor portals are added)
alter table public.carriers enable row level security;
alter table public.carrier_adjusters enable row level security;
alter table public.policies enable row level security;
alter table public.claims enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_line_items enable row level security;
alter table public.settlements enable row level security;

create policy "Carriers full access" on public.carriers for all to authenticated using (true) with check (true);
create policy "Carrier adjusters full access" on public.carrier_adjusters for all to authenticated using (true) with check (true);
create policy "Policies full access" on public.policies for all to authenticated using (true) with check (true);
create policy "Claims full access" on public.claims for all to authenticated using (true) with check (true);
create policy "Estimates full access" on public.estimates for all to authenticated using (true) with check (true);
create policy "Estimate line items full access" on public.estimate_line_items for all to authenticated using (true) with check (true);
create policy "Settlements full access" on public.settlements for all to authenticated using (true) with check (true);

alter table public.state_law_summaries enable row level security;
create policy "State law summaries full access" on public.state_law_summaries for all to authenticated using (true) with check (true);

alter table public.gmail_connections enable row level security;
create policy "Gmail connections: owner read" on public.gmail_connections for select to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Gmail connections: owner insert" on public.gmail_connections for insert to authenticated with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Gmail connections: owner update" on public.gmail_connections for update to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid())) with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Gmail connections: owner delete" on public.gmail_connections for delete to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));

alter table public.email_triage enable row level security;
create policy "Email triage: authenticated read" on public.email_triage for select to authenticated using (true);
create policy "Email triage: owner insert" on public.email_triage for insert to authenticated with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Email triage: owner update" on public.email_triage for update to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid())) with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Email triage: owner delete" on public.email_triage for delete to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));

alter table public.calendar_events enable row level security;
create policy "Calendar events: authenticated read" on public.calendar_events for select to authenticated using (true);
create policy "Calendar events: owner insert" on public.calendar_events for insert to authenticated with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Calendar events: owner update" on public.calendar_events for update to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid())) with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Calendar events: owner delete" on public.calendar_events for delete to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));

alter table public.dropbox_connections enable row level security;
create policy "Dropbox connections: owner read" on public.dropbox_connections for select to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Dropbox connections: owner insert" on public.dropbox_connections for insert to authenticated with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Dropbox connections: owner update" on public.dropbox_connections for update to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid())) with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Dropbox connections: owner delete" on public.dropbox_connections for delete to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));

alter table public.claim_dropbox_folders enable row level security;
create policy "Claim dropbox folders: authenticated read" on public.claim_dropbox_folders for select to authenticated using (true);
create policy "Claim dropbox folders: authenticated write" on public.claim_dropbox_folders for all to authenticated using (true) with check (true);

alter table public.claim_storm_verifications enable row level security;
create policy "Storm verifications: authenticated read" on public.claim_storm_verifications for select to authenticated using (true);
create policy "Storm verifications: authenticated write" on public.claim_storm_verifications for all to authenticated using (true) with check (true);

alter table public.briefings enable row level security;
create policy "Briefings: authenticated read" on public.briefings for select to authenticated using (true);
create policy "Briefings: owner insert" on public.briefings for insert to authenticated with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Briefings: owner update" on public.briefings for update to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid())) with check (sales_id in (select id from public.sales where user_id = auth.uid()));
create policy "Briefings: owner delete" on public.briefings for delete to authenticated using (sales_id in (select id from public.sales where user_id = auth.uid()));
