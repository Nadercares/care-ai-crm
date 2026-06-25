// AI-powered estimate comparison for a claim.
//
// POST /functions/v1/compare-estimates
// Body: { claim_id: number }
// Auth: caller JWT.
//
// Loads the claim, its policy, every estimate on the claim, and each
// estimate's line items. Asks Claude to produce a structured
// comparison: totals deltas, items missing from the carrier estimate,
// unit-price discrepancies, depreciation issues, policy red flags, and
// recommended leverage points (supplement, appraisal, mediation,
// litigation handoff) grounded in the policy and state.
//
// Decision support: the result is returned to the caller, NOT written
// back to the claim. Staff reviews and decides what (if anything) to
// save as notes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_COMPARE_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const COMPARISON_TOOL = {
  name: "save_estimate_comparison",
  description:
    "Save a structured comparison of carrier vs. public-adjuster (or contractor) estimates for a claim.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: {
        type: "string",
        description:
          "One-line plain-English headline. E.g. 'Carrier estimate $42,800 under PA estimate; missing roof replacement and code upgrades.'",
      },
      totals_diff: {
        type: "array",
        description:
          "Side-by-side comparison of the key dollar lines on each estimate.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: {
              type: "string",
              description:
                "One of rcv_total, acv_total, depreciation_total, deductible_applied, net_payable, overhead_pct, profit_pct, sales_tax.",
            },
            carrier_value: { type: ["number", "null"] },
            comparison_value: { type: ["number", "null"] },
            comparison_source: {
              type: "string",
              description:
                "What estimate the comparison_value came from (e.g. 'public_adjuster', 'contractor').",
            },
            gap_dollars: { type: ["number", "null"] },
            gap_pct: { type: ["number", "null"] },
            interpretation: { type: "string" },
          },
          required: ["field", "interpretation"],
        },
      },
      missing_from_carrier: {
        type: "array",
        description:
          "Line items that appear on the PA / contractor estimate but NOT on the carrier estimate (by code or close description match).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: ["string", "null"] },
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            line_rcv: { type: ["number", "null"] },
            justification: {
              type: "string",
              description:
                "Why this item should be paid (policy basis, code requirement, industry standard, manufacturer install spec).",
            },
          },
          required: ["description", "justification"],
        },
      },
      price_discrepancies: {
        type: "array",
        description:
          "Same line item on both estimates with materially different pricing.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: ["string", "null"] },
            description: { type: "string" },
            carrier_unit_price: { type: ["number", "null"] },
            comparison_unit_price: { type: ["number", "null"] },
            gap_pct: { type: ["number", "null"] },
            notes: { type: "string" },
          },
          required: ["description", "notes"],
        },
      },
      depreciation_issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            scope: {
              type: "string",
              description:
                "'total' for whole-estimate depreciation, or a line code / description.",
            },
            issue: { type: "string" },
            recommended_action: { type: "string" },
          },
          required: ["issue", "recommended_action"],
        },
      },
      policy_red_flags: {
        type: "array",
        description:
          "Things the carrier estimate does that don't square with the policy as loaded (wrong deductible, ACV when RCV is owed, missed ordinance-and-law tier, etc.).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            issue: { type: "string" },
            policy_basis: { type: "string" },
            recommended_action: { type: "string" },
          },
          required: ["issue", "recommended_action"],
        },
      },
      recommended_leverage: {
        type: "array",
        description:
          "Ordered escalation moves. Stop at appraisal/mediation/litigation only after lower-cost steps have a clear basis.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            strategy: {
              type: "string",
              description:
                "supplement | reinspection | appraisal | mediation | attorney_handoff | other",
            },
            rationale: { type: "string" },
            applies_when: { type: "string" },
            draft_language: {
              type: ["string", "null"],
              description:
                "Optional short draft email or letter sentence the firm can edit and use. Decision support only.",
            },
          },
          required: ["strategy", "rationale"],
        },
      },
      confidence_notes: {
        type: "string",
        description:
          "What was missing or ambiguous in the inputs (e.g. no line items on either estimate, policy summary blank, state unknown).",
      },
    },
    required: ["headline", "totals_diff", "confidence_notes"],
  },
} as const;

const SYSTEM = `You are CARE AI, an expert public-adjuster analyst.

Compare insurance estimates for a single claim. Be specific, conservative, and accurate. Hard rules:

- Decision support, NOT legal advice. Anything you draft must be reviewed by licensed firm staff before it leaves the office.
- Never invent line items, code numbers, policy provisions, or statute citations. If the inputs don't contain them, say so in confidence_notes.
- When comparing depreciation, remember labor-depreciation legality varies by state — flag the state and note that policy form + state rule must be confirmed.
- When recommending appraisal, remember the policy form must contain an appraisal clause and the state must allow it; surface this as a check, not an assumption.
- O&P justification: industry rule of thumb is "three trades or more" — apply it conservatively, not automatically.
- Roof matching, ordinance-and-law tier (10% / 25% / 50%), and water back-up are common carrier-undervaluation vectors — check the policy summary for these.
- Hurricane / wind-hail percent deductible: confirm peril classification (named storm vs. wind/hail vs. AOP) before agreeing with the carrier's applied deductible.
- The "carrier" estimate is the baseline; the comparison source is the PA estimate, contractor estimate, or whichever non-carrier estimate is present. If multiple non-carrier estimates exist, compare to the PA one if present, else the first non-carrier.
- If line items are absent on one or both sides, still compare totals and flag the missing detail in confidence_notes.

You MUST call save_estimate_comparison exactly once and emit no other text.`;

interface Body {
  claim_id: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY)
    return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body?.claim_id || typeof body.claim_id !== "number") {
    return json({ error: "claim_id (number) is required" }, 400);
  }

  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load claim (RLS-protected via user JWT).
  const { data: claim, error: claimError } = await userClient
    .from("claims")
    .select(
      "id, claim_number, date_of_loss, date_reported, type_of_loss, cause_of_loss, loss_location_state, loss_location_city, status, description, policy_id, carrier_id",
    )
    .eq("id", body.claim_id)
    .single();
  if (claimError || !claim) {
    return json({ error: "Claim not found or not accessible" }, 404);
  }

  // Load policy if linked.
  let policy: Record<string, unknown> | null = null;
  if (claim.policy_id) {
    const { data } = await userClient
      .from("policies")
      .select(
        "id, policy_number, policy_type, effective_date, expiration_date, state_abbr, coverage_a_dwelling, coverage_b_other_structures, coverage_c_personal_property, coverage_d_loss_of_use, all_other_perils_deductible, hurricane_deductible_pct, hurricane_deductible_amount, wind_hail_deductible_pct, flood_deductible, endorsements, exclusions, summary",
      )
      .eq("id", claim.policy_id)
      .single();
    policy = data;
  }

  // Load carrier name for headlines.
  let carrierName: string | null = null;
  if (claim.carrier_id) {
    const { data } = await userClient
      .from("carriers")
      .select("name")
      .eq("id", claim.carrier_id)
      .single();
    carrierName = data?.name ?? null;
  }

  // Load all estimates for the claim.
  const { data: estimates, error: estError } = await userClient
    .from("estimates")
    .select(
      "id, source, source_name, software, estimate_date, rcv_total, acv_total, depreciation_total, deductible_applied, net_payable, overhead_pct, profit_pct, sales_tax, summary, notes",
    )
    .eq("claim_id", body.claim_id)
    .order("created_at", { ascending: true });
  if (estError) {
    return json(
      { error: "Failed to load estimates", detail: estError.message },
      500,
    );
  }
  if (!estimates || estimates.length < 2) {
    return json(
      {
        error:
          "Need at least two estimates to compare (e.g. one carrier and one public-adjuster).",
        estimate_count: estimates?.length ?? 0,
      },
      400,
    );
  }

  // Load line items per estimate.
  const estimateIds = estimates.map((e) => e.id);
  const { data: allLineItems } = await userClient
    .from("estimate_line_items")
    .select(
      "id, estimate_id, room, category, code, description, quantity, unit, unit_price, rcv, acv, depreciation, age_life, condition",
    )
    .in("estimate_id", estimateIds);
  const itemsByEstimate = new Map<number, unknown[]>();
  for (const it of allLineItems ?? []) {
    const list = itemsByEstimate.get(it.estimate_id) ?? [];
    list.push(it);
    itemsByEstimate.set(it.estimate_id, list);
  }
  const estimatesWithItems = estimates.map((e) => ({
    ...e,
    line_items: itemsByEstimate.get(e.id) ?? [],
  }));

  // Build the user-message payload.
  const inputs = {
    claim: { ...claim, carrier_name: carrierName },
    policy,
    estimates: estimatesWithItems,
  };

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tool_choice: { type: "tool", name: COMPARISON_TOOL.name },
      tools: [COMPARISON_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Compare the carrier estimate against the non-carrier estimate(s) for this claim. Inputs:\n\n```json\n" +
                JSON.stringify(inputs, null, 2) +
                "\n```\n\nCall save_estimate_comparison with your analysis.",
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => "");
    return json(
      {
        error: `Anthropic ${anthropicRes.status} ${anthropicRes.statusText}`,
        detail,
      },
      502,
    );
  }

  const reply = await anthropicRes.json();
  const toolUse = (reply?.content ?? []).find(
    (b: { type: string; name?: string }) =>
      b.type === "tool_use" && b.name === COMPARISON_TOOL.name,
  );
  if (!toolUse) {
    return json(
      { error: "Model did not return a tool_use block", raw: reply },
      502,
    );
  }

  return json({
    claim_id: body.claim_id,
    estimate_count: estimates.length,
    comparison: toolUse.input,
    model: ANTHROPIC_MODEL,
    usage: reply.usage,
  });
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
