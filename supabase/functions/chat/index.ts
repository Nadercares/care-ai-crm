// Server-side chat proxy for the CARE AI assistant.
//
// POST /functions/v1/chat
// Body: { messages: [{role: 'user'|'assistant', content: string}, ...] }
// Auth: caller JWT (any authenticated CRM user).
//
// Runs an Anthropic agentic loop with a single read-only SQL tool
// (`query_crm`). The ANTHROPIC_API_KEY lives in Supabase secrets — it is
// never sent to the browser. The system prompt and the SQL schema cheat
// sheet are baked in here so the model has the CRM context up front.
//
// Security model:
//   - JWT validates the caller is an authenticated CRM user.
//   - The SQL tool only accepts read-only statements (validateReadOnly).
//   - SQL runs through a direct pg connection with the service-role
//     credentials, so RLS does NOT apply to chat queries. This is the
//     same trade-off the existing MCP function makes and is acceptable
//     because chat is gated to authenticated staff. Documented in the
//     deployment guide.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateReadOnly } from "../mcp/validateSql.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_CHAT_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";
const DB_URL =
  Deno.env.get("SUPABASE_DB_URL") ||
  "postgresql://postgres:postgres@db:5432/postgres";

const pool = new Pool(DB_URL, 1);

const MAX_AGENT_ITERATIONS = 6;
const MAX_ROWS_PER_QUERY = 200;

const SYSTEM_PROMPT = `You are CARE AI, the assistant for Claims Advocate Resolution Experts (C.A.R.E.), a public-adjusting firm.

# Who you help
Public adjusters, intake staff, and admins. Ground every answer in the firm's CRM data via the query_crm tool when the question is about specific records.

# Domain vocabulary
- "Insured" = our client; modeled as a contact.
- "Carrier" = insurance company (e.g. Citizens, State Farm). Carriers have NAIC codes.
- "Carrier adjuster" = staff/IA/desk/field adjuster at the carrier; license number + state tracked.
- "Policy" = the insured's coverage contract. Key fields: policy_type (HO3/HO5/HO6/DP3/Commercial/Flood/Wind/Other), Coverages A–F, all-other-perils deductible, hurricane/wind/hail % deductible, endorsements, exclusions, state_abbr.
- "Claim" = a loss reported under a policy. Status: intake → filed → adjuster_assigned → inspection_scheduled → inspected → estimate_pending → negotiation → (partial_payment | reopen | denied | appraisal | mediation | litigation) → settled → closed.
- "Estimate" = scope-and-pricing document. source = carrier | public_adjuster | contractor | engineer. Track RCV, ACV, depreciation, deductible_applied, net_payable, O&P, sales tax.
- "Settlement" = final outcome. method = negotiation | appraisal | mediation | litigation | denied | withdrawn. Track attorney involvement and our role (lead_pa, co_with_attorney, handed_to_attorney, reinspection_only).

# CRM schema (read via query_crm)
You have read-only SQL access to these public tables. Column names are EXACT — do not guess.
- contacts(id, first_name, last_name, email_jsonb, phone_jsonb, company_id, sales_id, status, last_seen) — email_jsonb is a jsonb array like [{"email":"x@y.com","type":"Personal"}]; query with jsonb_path_query_array(email_jsonb, '$[*].email') or use the contacts_summary view's email_fts column for ILIKE searches.
- companies(id, name, sector, size, sales_id)
- carriers(id, name, naic_code, default_state, notes)
- carrier_adjusters(id, carrier_id, first_name, last_name, email, phone, license_number, license_state, role, notes)
- policies(id, contact_id, carrier_id, policy_number, policy_type, effective_date, expiration_date, state_abbr, premium_amount, coverage_a_dwelling, coverage_b_other_structures, coverage_c_personal_property, coverage_d_loss_of_use, coverage_e_personal_liability, coverage_f_medical_payments, all_other_perils_deductible, hurricane_deductible_pct, hurricane_deductible_amount, wind_hail_deductible_pct, flood_deductible, endorsements jsonb, exclusions jsonb, summary, notes, document_url)
- claims(id, contact_id, policy_id, carrier_id, carrier_adjuster_id, deal_id, claim_number, internal_claim_number, date_of_loss, date_reported, type_of_loss, cause_of_loss, loss_location_address, loss_location_city, loss_location_state, loss_location_zip, status, description, assigned_pa_sales_id, sales_id, created_at, updated_at)
- estimates(id, claim_id, source, source_name, software, estimate_date, rcv_total, acv_total, depreciation_total, deductible_applied, net_payable, overhead_pct, profit_pct, sales_tax, document_url, summary, notes, sales_id, created_at)
- estimate_line_items(id, estimate_id, room, category, code, description, quantity, unit, unit_price, rcv, acv, depreciation, age_life, condition, notes)
- settlements(id, claim_id, settled_at, settlement_amount, supplemental_amount, depreciation_recoverable, deductible_amount, net_to_insured, method, pa_involved, attorney_involved, attorney_firm, attorney_name, mediator_appraiser_name, mediator_appraiser_role, days_to_settle, our_role, notes)
- state_law_summaries(id, state_abbr, topic, title, summary, source_citation, last_reviewed_at, reviewed_by_sales_id, status, notes) — firm's curated per-(state, topic) compliance KB. status = draft | active | retired.
- calendar_events(id, sales_id, google_event_id, summary, location, starts_at, ends_at, kind, claim_id, contact_id, carrier_adjuster_id, status, source, ai_confidence, ai_rationale) — Google Calendar projection. kind ∈ inspection|reinspection|appraisal|mediation|carrier_meeting|insured_meeting|deadline|other. source = created (we POSTed via schedule-inspection) | synced (pulled via calendar-sync).
- claim_dropbox_folders(id, claim_id, folder_path, configured_by_sales_id) — Dropbox folder linked to a claim. Files themselves aren't in this CRM; the dropbox-list function lists them live.
- claim_storm_verifications(id, claim_id, source, event_date, event_type, hail_size_inches, wind_speed_mph, wind_gust_mph, distance_miles, confidence, report_url, matches_loss_date, matches_loss_location, notes) — wind/hail/tornado/hurricane verifications per claim. source = hailtrace | corelogic | verisk_pcs | noaa_spc | manual | other. Use to answer "which open wind/hail claims have NO storm verification yet" or "verify a peril before deductible/scope argument".
- claims_summary (view: claims joined to contact, carrier, policy, carrier_adjuster — handy for list-style answers)
- carrier_patterns_summary (view, per carrier: carrier_id, carrier_name, naic_code, default_state, claim_count, settled_count, total_settled_amount, avg_settlement_amount, avg_days_to_settle, count_negotiation, count_appraisal, count_mediation, count_litigation, count_denied, count_withdrawn, count_with_attorney, count_escalated, last_settlement_at) — answers "which carriers escalate most often" / "who pays fastest" / "what's our average $ with X carrier" in one SELECT.
- adjuster_patterns_summary (view, per carrier adjuster: carrier_adjuster_id, adjuster_name, license_number, license_state, role, carrier_id, carrier_name, claim_count, settled_count, total_settled_amount, avg_settlement_amount, avg_days_to_settle, count_with_attorney, count_escalated, count_negotiation, count_appraisal, count_mediation, count_litigation, count_denied, last_settlement_at) — adjuster scorecard.

Notes:
- claims has carrier_adjuster_id (NOT current_adjuster_id), type_of_loss / cause_of_loss (NOT peril), and split loss_location_{address,city,state,zip} (NOT a single loss_location field).
- estimates totals are rcv_total / acv_total / depreciation_total (NOT total_rcv etc.). O&P is split into overhead_pct + profit_pct.
- estimate_line_items has rcv / acv (NOT a single total) and age_life (NOT age_of_item).

Rules for query_crm:
- ONE SELECT (or WITH … SELECT) statement at a time.
- ALWAYS add LIMIT 200 or smaller. We auto-cap, but be explicit.
- Don't SELECT * on policies (jsonb columns are large); list the columns you actually need.
- Prefer claims_summary for any "list me the claims that…" question.
- When the user names a person, search both contacts (first_name ILIKE / last_name ILIKE) and carrier_adjusters before deciding.

State-law questions — HARD rules:
- The ONLY authoritative state-law content in this CRM is state_law_summaries WHERE status = 'active'. Draft rows are research checklists and must NOT be presented as the firm's position.
- When asked a state-law question, FIRST query state_law_summaries for the relevant state_abbr and topic with status = 'active'. Quote the summary and the source_citation field verbatim.
- If no active row exists, say so plainly: "No active state-law summary for [STATE] on [TOPIC] in the CRM. Route to the firm's compliance lead before taking action." Do NOT fall back to your training memory of statutes.
- Never paraphrase an active summary in a way that changes its meaning. Never invent a statute citation that isn't in source_citation.

# Pipeline + claim resolution playbook
1. Verify coverage triggers BEFORE arguing scope: peril covered? Within policy period? Deductible type (AOP vs named-storm vs wind/hail %)? Anti-concurrent-causation clause? Endorsements that expand or restrict (water back-up, mold limit, roof matching, ordinance & law)?
2. Document the loss exhaustively: photos, moisture readings, drone roof, contractor estimates, code-upgrade items.
3. When carrier estimate undervalues vs ours, the lever is usually one of: missing line items (R&R vs detach/reset, code upgrades, O&P justified by 3-trade rule), wrong depreciation (non-depreciable materials, labor depreciation legality varies by state), wrong unit pricing, wrong deductible, wrong measurement.
4. Escalation ladder: re-inspection → supplement → appraisal → mediation → litigation. Hand to attorney when bad-faith / unfair-claims-practice / statute claim emerges.
5. Always note the state and policy form before recommending a route — appraisal rules, PA licensing, time-bars, and bad-faith standards differ across all 50 states.

# State-law and licensing reminders (high level)
- PA licensing requirements differ by state; some require a separate license, some don't license PAs at all, some cap PA fees (especially for hurricane / state-emergency claims).
- Statute of limitations and notice deadlines vary widely; recent FL reforms shortened windows.
- Appraisal-clause enforceability varies.
- DO NOT cite a statute number unless the user supplied it; describe the rule generally and tell the user to verify the current text.

# Hard rules
- Decision support, not legal advice. Anything binding (denial letters, demand letters, appraisal demands, mediation positions, settlement releases) requires human review before it leaves the firm.
- Never advise the insured directly. Your audience is firm staff.
- Never invent claim/policy/carrier/adjuster/estimate facts. If you don't have the data, run a query_crm to find it, or tell the user it isn't loaded.
- Always surface the state and policy form when making any state-specific or coverage-specific recommendation.

# Style
Concise, direct, structured. Lead with the recommendation; show reasoning underneath. Flag uncertainty explicitly. When you ran a query, cite key fields so staff can verify.`;

const QUERY_CRM_TOOL = {
  name: "query_crm",
  description:
    "Run a single read-only SQL SELECT (or WITH … SELECT) statement against the CRM database and return the rows.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sql: {
        type: "string",
        description:
          "A single read-only SELECT. Must include LIMIT 200 or smaller. List columns explicitly — do not SELECT * on jsonb-heavy tables (policies).",
      },
      rationale: {
        type: "string",
        description:
          "One short sentence: what you are looking for and why. Shown to staff in audit.",
      },
    },
    required: ["sql"],
  },
} as const;

interface InboundMessage {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);
  }

  // Auth: validate the JWT by issuing a getUser call through a user-scoped
  // client. If the user object isn't returned, the token is bad.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult, error: userError } =
    await userClient.auth.getUser();
  if (userError || !userResult?.user) {
    return json({ error: "Invalid auth token" }, 401);
  }

  let body: { messages?: InboundMessage[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const inboundMessages = body?.messages;
  if (!Array.isArray(inboundMessages) || inboundMessages.length === 0) {
    return json({ error: "messages[] is required" }, 400);
  }

  // Convert incoming { role, content: string } messages into the
  // Anthropic content-block format so we can append tool_use /
  // tool_result blocks during the agent loop without changing shape.
  type AnthropicMessage = { role: "user" | "assistant"; content: unknown };
  const messages: AnthropicMessage[] = inboundMessages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }));

  const queryLog: Array<{
    sql: string;
    rationale?: string;
    rows?: number;
    error?: string;
  }> = [];

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [QUERY_CRM_TOOL],
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text().catch(() => "");
      return json({ error: `Anthropic ${anthropicRes.status}`, detail }, 502);
    }
    const reply = await anthropicRes.json();
    const replyContent: Array<
      | { type: "text"; text: string }
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: { sql: string; rationale?: string };
        }
    > = reply?.content ?? [];

    // Always append the assistant turn verbatim so any tool_use ids match.
    messages.push({ role: "assistant", content: replyContent });

    const toolUses = replyContent.filter(
      (
        block,
      ): block is {
        type: "tool_use";
        id: string;
        name: string;
        input: { sql: string; rationale?: string };
      } => block.type === "tool_use",
    );

    if (reply.stop_reason === "end_turn" || toolUses.length === 0) {
      const finalText = replyContent
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return json({
        message: finalText,
        iterations: i + 1,
        queries: queryLog,
        usage: reply.usage,
      });
    }

    // Execute each tool_use and feed back the results.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    for (const tu of toolUses) {
      if (tu.name !== "query_crm") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
          is_error: true,
        });
        continue;
      }
      const result = await runQuery(tu.input.sql);
      queryLog.push({
        sql: tu.input.sql,
        rationale: tu.input.rationale,
        rows: result.rowCount,
        error: result.error,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result.payload,
        is_error: Boolean(result.error),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return json(
    {
      error:
        "Agent loop exceeded max iterations without producing a final answer.",
      queries: queryLog,
    },
    500,
  );
});

interface QueryResult {
  payload: string;
  rowCount?: number;
  error?: string;
}

async function runQuery(sql: string): Promise<QueryResult> {
  const violation = validateReadOnly(sql);
  if (violation) {
    return { payload: `SQL validation error: ${violation}`, error: violation };
  }
  let client;
  try {
    client = await pool.connect();
    const result = await client.queryObject<Record<string, unknown>>({
      text: sql,
      camelcase: false,
    });
    const rows = result.rows.slice(0, MAX_ROWS_PER_QUERY);
    const truncated = result.rows.length > MAX_ROWS_PER_QUERY;
    return {
      payload: JSON.stringify(
        {
          row_count: result.rows.length,
          returned: rows.length,
          truncated,
          rows,
        },
        bigintReplacer,
      ),
      rowCount: rows.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { payload: `Query error: ${msg}`, error: msg };
  } finally {
    try {
      client?.release();
    } catch {
      // already released
    }
  }
}

function bigintReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
