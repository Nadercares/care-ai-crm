-- CARE AI test-data seed.
--
-- Drops and reinserts every row tagged "seed:" so this script is
-- safe to re-run. Touches NOTHING that staff might have entered
-- by hand (those rows have notes/description without the "seed:"
-- prefix).
--
-- Run AFTER signing up at least once (the seed needs a sales row).
--
--   make seed-care-ai
--
-- ...or manually:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
--        -f supabase/seed-care-ai.sql

do $$
declare
    v_sales_id bigint;

    -- Carrier ids
    v_citizens bigint;
    v_state_farm bigint;
    v_allstate bigint;
    v_universal bigint;
    v_heritage bigint;
    v_tower_hill bigint;

    -- Working vars
    v_carrier bigint;
    v_adjuster bigint;
    v_contact bigint;
    v_policy bigint;
    v_claim bigint;
    v_estimate_carrier bigint;
    v_estimate_pa bigint;
    v_first_name text;
    v_last_name text;
    v_dol date;
    v_state text;
    v_city text;
    v_status text;
    v_type_of_loss text;
    v_cause_of_loss text;
    v_carrier_idx int;
    v_carrier_arr bigint[];
    v_method text;
    v_attorney boolean;
    v_days_to_settle int;
    v_carrier_rcv numeric;
    v_pa_rcv numeric;
    v_settle_pct numeric;
    v_settle_amount numeric;
    i int;

    first_names text[] := ARRAY[
        'Maria', 'Carlos', 'Ana', 'Luis', 'Sofia', 'Diego', 'Isabella', 'Miguel',
        'Lucia', 'Javier', 'Elena', 'Roberto', 'Carmen', 'Antonio', 'Patricia',
        'Francisco', 'Jennifer', 'David', 'Michelle', 'James', 'Linda', 'Robert',
        'Susan', 'Richard', 'Karen', 'Joseph', 'Nancy', 'Thomas', 'Betty', 'Daniel'
    ];
    last_names text[] := ARRAY[
        'Garcia', 'Rodriguez', 'Martinez', 'Lopez', 'Hernandez', 'Gonzalez',
        'Perez', 'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Smith',
        'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
        'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson',
        'Robinson', 'Clark', 'Lewis'
    ];
    cities_fl text[] := ARRAY[
        'Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Naples',
        'Tallahassee', 'Cape Coral', 'St Petersburg', 'Hialeah', 'Coral Gables',
        'Doral', 'Hollywood', 'Pembroke Pines', 'Sarasota'
    ];
begin
    -- 1. Get a sales_id (first signup).
    select id into v_sales_id from public.sales order by id limit 1;
    if v_sales_id is null then
        raise exception 'No sales row found. Sign up via the CRM at least once before seeding.';
    end if;

    -- 2. Wipe prior seed.
    delete from public.claim_storm_verifications where notes like 'seed:%';
    delete from public.settlements where notes like 'seed:%';
    delete from public.estimate_line_items where notes like 'seed:%';
    delete from public.estimates where notes like 'seed:%';
    delete from public.claims where description like 'seed:%';
    delete from public.policies where notes like 'seed:%';
    delete from public.contacts where background = 'seed:contact';
    delete from public.carrier_adjusters where notes like 'seed:%';
    delete from public.carriers where notes like 'seed:%';

    -- 3. Carriers (FL heavy). Each gets a notes='seed:' marker.
    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('Citizens Property Insurance', '10064', 'FL', '866-411-2742', 'claims@citizensfla.com', 'seed:fast-attorney-mediation')
    returning id into v_citizens;

    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('State Farm Florida', '25178', 'FL', '800-732-5246', 'claims@statefarm.com', 'seed:slow-appraisal-heavy')
    returning id into v_state_farm;

    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('Allstate', '19232', 'IL', '800-255-7828', 'claims@allstate.com', 'seed:fast-negotiation')
    returning id into v_allstate;

    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('Universal Property & Casualty', '10759', 'FL', '800-470-0599', 'claims@universalproperty.com', 'seed:mixed')
    returning id into v_universal;

    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('Heritage Insurance', '13017', 'FL', '888-892-4011', 'claims@heritagepci.com', 'seed:high-denial')
    returning id into v_heritage;

    insert into public.carriers (name, naic_code, default_state, claims_phone, claims_email, notes)
    values ('Tower Hill Insurance', '14729', 'FL', '800-342-3407', 'claims@thig.com', 'seed:low-volume')
    returning id into v_tower_hill;

    -- 4. Carrier adjusters (3-4 per carrier).
    for v_carrier, v_carrier_idx in
        select unnest(array[v_citizens, v_state_farm, v_allstate, v_universal, v_heritage, v_tower_hill]),
               generate_series(1, 6)
    loop
        for i in 1..(case when v_carrier_idx <= 2 then 4 else 3 end) loop
            insert into public.carrier_adjusters (
                carrier_id, first_name, last_name, license_number, license_state,
                email, phone, role, notes
            )
            values (
                v_carrier,
                first_names[1 + (random()*29)::int],
                last_names[1 + (random()*29)::int],
                'P-' || lpad((100000 + (random()*899999)::int)::text, 6, '0'),
                'FL',
                lower(first_names[1 + (random()*29)::int]) || '.' ||
                  lower(last_names[1 + (random()*29)::int]) || '@adjuster.example',
                '(305) ' || lpad((100 + (random()*899)::int)::text, 3, '0') ||
                  '-' || lpad((1000 + (random()*8999)::int)::text, 4, '0'),
                case ((random()*3)::int)
                    when 0 then 'desk'
                    when 1 then 'field'
                    else 'independent'
                end,
                'seed:adjuster'
            );
        end loop;
    end loop;

    -- 5. Contacts (30 insureds, all FL).
    for i in 1..30 loop
        v_first_name := first_names[1 + ((i-1) % 30)];
        v_last_name := last_names[1 + ((i*7) % 30)];
        v_city := cities_fl[1 + ((i-1) % 15)];

        insert into public.contacts (
            first_name, last_name, gender, status, background, sales_id,
            email_jsonb, phone_jsonb, first_seen, last_seen
        )
        values (
            v_first_name, v_last_name,
            case (i % 2) when 0 then 'female' else 'male' end,
            'in-contract',
            'seed:contact',
            v_sales_id,
            jsonb_build_array(
                jsonb_build_object(
                    'email',
                    lower(v_first_name) || '.' || lower(v_last_name) || i || '@insured.example',
                    'type', 'Personal'
                )
            ),
            jsonb_build_array(
                jsonb_build_object(
                    'number',
                    '(' || (305 + (i % 5))::text || ') ' ||
                      lpad((100 + (i*13) % 900)::text, 3, '0') ||
                      '-' || lpad((1000 + (i*97) % 9000)::text, 4, '0'),
                    'type', 'Mobile'
                )
            ),
            current_timestamp - (i * 30 || ' days')::interval,
            current_timestamp - (i * 7 || ' days')::interval
        )
        returning id into v_contact;

        -- 5b. Policy per contact, carrier weighted toward FL
        v_carrier_arr := array[
            v_citizens, v_citizens, v_citizens,    -- 3x
            v_state_farm, v_state_farm,            -- 2x
            v_allstate,
            v_universal, v_universal,              -- 2x
            v_heritage,
            v_tower_hill
        ];
        v_carrier := v_carrier_arr[1 + ((i-1) % 10)];

        insert into public.policies (
            contact_id, carrier_id, policy_number, policy_type,
            effective_date, expiration_date, state_abbr,
            premium_amount,
            coverage_a_dwelling, coverage_b_other_structures,
            coverage_c_personal_property, coverage_d_loss_of_use,
            coverage_e_personal_liability, coverage_f_medical_payments,
            all_other_perils_deductible,
            hurricane_deductible_pct,
            summary, notes, sales_id
        )
        values (
            v_contact, v_carrier,
            'POL-' || lpad((1000 + i)::text, 6, '0'),
            case ((i % 5)::int)
                when 0 then 'HO6'
                when 1 then 'DP3'
                when 2 then 'HO5'
                else 'HO3'
            end,
            current_date - ((180 + (random()*180)::int) || ' days')::interval,
            current_date + ((180 + (random()*180)::int) || ' days')::interval,
            'FL',
            1800 + (random()*4000)::int,
            250000 + ((random()*350000)::int / 1000 * 1000),
            25000 + (random()*15000)::int,
            150000 + (random()*80000)::int,
            50000 + (random()*30000)::int,
            300000,
            5000,
            2500 + ((random()*5)::int * 500),
            2,
            case ((i % 3)::int)
                when 0 then 'HO3 form with hurricane 2% calendar-year deductible. Ordinance & law coverage tier B (25%). No water back-up endorsement. Roof matching language: replacement of damaged slope only.'
                when 1 then 'HO5 open-peril form. Hurricane 5% deductible. Includes water back-up coverage $10k limit. Matching language requires replacement of materials no longer obtainable.'
                else 'DP3 dwelling form for rental property. AOP $2500 / hurricane 2%. Loss-of-rents coverage equal to 12 months Coverage A. No personal property coverage.'
            end,
            'seed:policy',
            v_sales_id
        )
        returning id into v_policy;

        -- 5c. Claims: 1-2 per contact, total ~50.
        for v_claim in select unnest(case when i <= 20 then array[1,2] else array[1] end) loop
            v_dol := current_date - ((30 + (random()*540)::int) || ' days')::interval;

            -- Type of loss bias toward wind/hail since FL.
            case ((random()*10)::int)
                when 0,1,2,3,4 then  -- 50% wind/hail
                    v_type_of_loss := 'wind';
                    v_cause_of_loss := case (random()*3)::int
                        when 0 then 'hurricane wind'
                        when 1 then 'severe thunderstorm wind'
                        else 'hail'
                    end;
                when 5,6 then         -- 20% water
                    v_type_of_loss := 'water';
                    v_cause_of_loss := case (random()*3)::int
                        when 0 then 'plumbing supply line burst'
                        when 1 then 'AC condensate overflow'
                        else 'water heater failure'
                    end;
                when 7 then           -- 10% fire
                    v_type_of_loss := 'fire';
                    v_cause_of_loss := 'kitchen fire';
                when 8 then           -- 10% theft
                    v_type_of_loss := 'theft';
                    v_cause_of_loss := 'burglary';
                else                  -- 10% mold/other
                    v_type_of_loss := 'mold';
                    v_cause_of_loss := 'undetected water intrusion';
            end case;

            -- Status: distribution weighted toward settled/in-process.
            v_status := case ((random()*10)::int)
                when 0,1 then 'settled'
                when 2 then 'closed'
                when 3,4,5 then 'negotiation'
                when 6 then 'inspection_scheduled'
                when 7 then 'estimate_pending'
                when 8 then 'appraisal'
                else 'filed'
            end;

            -- Pick an adjuster from this carrier.
            select id into v_adjuster
            from public.carrier_adjusters
            where carrier_id = v_carrier
            order by random()
            limit 1;

            insert into public.claims (
                contact_id, policy_id, carrier_id, carrier_adjuster_id,
                claim_number, internal_claim_number,
                date_of_loss, date_reported,
                type_of_loss, cause_of_loss,
                loss_location_address, loss_location_city,
                loss_location_state, loss_location_zip,
                status, description,
                assigned_pa_sales_id, sales_id
            )
            values (
                v_contact, v_policy, v_carrier, v_adjuster,
                'CLM-' || lpad((100000 + (random()*899999)::int)::text, 6, '0'),
                'INT-' || lpad((1000 + i*10 + v_claim)::text, 6, '0'),
                v_dol,
                v_dol + ((1 + (random()*7)::int) || ' days')::interval,
                v_type_of_loss, v_cause_of_loss,
                (100 + (random()*9000)::int)::text || ' ' ||
                  case (random()*5)::int
                      when 0 then 'Ocean Dr'
                      when 1 then 'Coral Way'
                      when 2 then 'Sunset Blvd'
                      when 3 then 'Bay St'
                      else 'Palm Ave'
                  end,
                v_city,
                'FL',
                (33000 + (random()*900)::int)::text,
                v_status,
                'seed:claim — ' || v_type_of_loss || ' / ' || v_cause_of_loss,
                v_sales_id, v_sales_id
            )
            returning id into v_claim;

            -- Estimates: always a carrier estimate. ~75% also a PA estimate.
            v_carrier_rcv := 8000 + (random()*55000)::int;

            insert into public.estimates (
                claim_id, source, source_name, software, estimate_date,
                rcv_total, acv_total, depreciation_total,
                deductible_applied, net_payable,
                overhead_pct, profit_pct, sales_tax,
                summary, notes, sales_id
            )
            values (
                v_claim, 'carrier',
                (select name from public.carriers where id = v_carrier) || ' staff',
                'Xactimate',
                v_dol + ((10 + (random()*20)::int) || ' days')::interval,
                v_carrier_rcv,
                v_carrier_rcv * 0.78,
                v_carrier_rcv * 0.22,
                2500,
                greatest(0, v_carrier_rcv * 0.78 - 2500),
                10, 10, 245.50,
                'Carrier estimate. Roof partial repair, drywall patch in living room, no code-upgrade items.',
                'seed:carrier-estimate', v_sales_id
            );

            if random() < 0.75 then
                v_pa_rcv := v_carrier_rcv * (1.4 + random() * 1.1);
                insert into public.estimates (
                    claim_id, source, source_name, software, estimate_date,
                    rcv_total, acv_total, depreciation_total,
                    deductible_applied, net_payable,
                    overhead_pct, profit_pct, sales_tax,
                    summary, notes, sales_id
                )
                values (
                    v_claim, 'public_adjuster', 'CARE PA team',
                    'Xactimate',
                    v_dol + ((35 + (random()*30)::int) || ' days')::interval,
                    v_pa_rcv,
                    v_pa_rcv * 0.85,
                    v_pa_rcv * 0.15,
                    2500,
                    greatest(0, v_pa_rcv * 0.85 - 2500),
                    10, 10, 412.30,
                    'PA estimate. Full roof R&R per matching law, drywall full replacement, code upgrade per FBC 2020 (ordinance & law tier B), R&R kitchen cabinets due to wind-driven debris.',
                    'seed:pa-estimate', v_sales_id
                );
            end if;

            -- Settlements: only if claim is settled/closed. Carrier patterns!
            if v_status in ('settled', 'closed') then
                -- Per-carrier patterns:
                if v_carrier = v_citizens then
                    v_method := case (random()*5)::int
                        when 0 then 'negotiation'
                        when 1,2 then 'mediation'
                        when 3 then 'appraisal'
                        else 'litigation'
                    end;
                    v_attorney := random() < 0.35;
                    v_days_to_settle := 30 + (random()*60)::int;
                    v_settle_pct := 0.65 + random() * 0.25;
                elsif v_carrier = v_state_farm then
                    v_method := case (random()*5)::int
                        when 0,1 then 'negotiation'
                        when 2,3 then 'appraisal'
                        else 'mediation'
                    end;
                    v_attorney := random() < 0.15;
                    v_days_to_settle := 70 + (random()*80)::int;
                    v_settle_pct := 0.75 + random() * 0.2;
                elsif v_carrier = v_allstate then
                    v_method := case (random()*5)::int
                        when 0,1,2,3 then 'negotiation'
                        else 'appraisal'
                    end;
                    v_attorney := random() < 0.10;
                    v_days_to_settle := 35 + (random()*40)::int;
                    v_settle_pct := 0.70 + random() * 0.2;
                elsif v_carrier = v_heritage then
                    v_method := case (random()*5)::int
                        when 0,1 then 'denied'
                        when 2 then 'litigation'
                        when 3 then 'mediation'
                        else 'negotiation'
                    end;
                    v_attorney := random() < 0.45;
                    v_days_to_settle := 90 + (random()*120)::int;
                    v_settle_pct := case when v_method = 'denied' then 0 else 0.55 + random() * 0.25 end;
                else
                    v_method := case (random()*4)::int
                        when 0,1 then 'negotiation'
                        when 2 then 'appraisal'
                        else 'mediation'
                    end;
                    v_attorney := random() < 0.20;
                    v_days_to_settle := 50 + (random()*60)::int;
                    v_settle_pct := 0.65 + random() * 0.25;
                end if;

                v_settle_amount := round(coalesce(v_pa_rcv, v_carrier_rcv) * v_settle_pct);

                insert into public.settlements (
                    claim_id, settled_at, settlement_amount,
                    supplemental_amount, depreciation_recoverable,
                    deductible_amount, net_to_insured,
                    method, pa_involved, attorney_involved,
                    attorney_firm, days_to_settle, our_role,
                    notes, sales_id
                )
                values (
                    v_claim,
                    (v_dol + (v_days_to_settle || ' days')::interval)::date,
                    v_settle_amount,
                    0,
                    v_settle_amount * 0.15,
                    2500,
                    greatest(0, v_settle_amount - 2500),
                    v_method,
                    true,
                    v_attorney,
                    case when v_attorney then
                        case (random()*3)::int
                            when 0 then 'Hunter & Associates'
                            when 1 then 'Morgan Law Group'
                            else 'Boyer & Jaffe'
                        end
                    end,
                    v_days_to_settle,
                    case when v_attorney then 'co_with_attorney' else 'lead_pa' end,
                    'seed:settlement', v_sales_id
                );
            end if;

            -- Storm verifications for wind/hail claims (~60% of them).
            if v_type_of_loss = 'wind' and random() < 0.65 then
                insert into public.claim_storm_verifications (
                    claim_id, sales_id, source, event_date, event_type,
                    hail_size_inches, wind_speed_mph, wind_gust_mph,
                    distance_miles, confidence, report_url,
                    matches_loss_date, matches_loss_location, notes
                )
                values (
                    v_claim, v_sales_id, 'noaa_spc',
                    v_dol,
                    case when v_cause_of_loss = 'hail' then 'hail' else 'wind' end,
                    case when v_cause_of_loss = 'hail' then (0.75 + random()*1.5)::numeric(4,2) else null end,
                    case when v_cause_of_loss = 'hail' then null else 45 + (random()*45)::int end,
                    case when v_cause_of_loss = 'hail' then null else 60 + (random()*40)::int end,
                    (random()*2.5)::numeric(4,2),
                    case (random()*3)::int when 0 then 'high' when 1 then 'medium' else 'low' end,
                    'https://www.spc.noaa.gov/exper/archive/event.php?date=' ||
                        to_char(v_dol, 'YYYYMMDD'),
                    true,
                    true,
                    'seed:storm — NOAA SPC archive entry, seeded for testing.'
                );
            end if;
        end loop;
    end loop;

    raise notice 'CARE AI seed complete. carriers=6, adjusters=21, contacts=30, policies=30, claims=~50';
end$$;
