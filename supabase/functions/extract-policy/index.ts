// Extract structured policy data from an uploaded PDF using Claude.
//
// POST /functions/v1/extract-policy
// Body: { policy_id: number }
// Auth: caller JWT (a logged-in CRM user).
//
// The function:
//   1. Validates the JWT and loads the calling user.
//   2. Reads the policy row (subject to RLS) to get its document path.
//   3. Downloads the PDF from the `attachments` bucket (admin client, since
//      we already verified the user has read access to the policy via RLS
//      in step 2).
//   4. Sends the PDF to Anthropic's API and forces a single tool call that
//      returns a structured JSON extraction.
//   5. Returns the extraction to the caller. We deliberately do NOT mutate
//      the policy row on the server side — the staff member reviews and
//      saves on the client, preserving the decision-support framing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY env var is required");
}

const EXTRACTION_TOOL = {
  name: "save_policy_extraction",
  description:
    "Save the structured extraction of an insurance policy declaration page / policy form.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      policy_number: { type: ["string", "null"] },
      policy_type: {
        type: ["string", "null"],
        description:
          "One of HO3, HO5, HO6, HO8, DP1, DP3, Commercial, BOP, Flood-NFIP, Flood-Private, Wind, Auto, Other.",
      },
      carrier_name: { type: ["string", "null"] },
      naic_code: { type: ["string", "null"] },
      effective_date: {
        type: ["string", "null"],
        description: "ISO date (YYYY-MM-DD) if present.",
      },
      expiration_date: { type: ["string", "null"] },
      state_abbr: { type: ["string", "null"] },
      premium_amount: { type: ["number", "null"] },
      coverage_a_dwelling: { type: ["number", "null"] },
      coverage_b_other_structures: { type: ["number", "null"] },
      coverage_c_personal_property: { type: ["number", "null"] },
      coverage_d_loss_of_use: { type: ["number", "null"] },
      coverage_e_personal_liability: { type: ["number", "null"] },
      coverage_f_medical_payments: { type: ["number", "null"] },
      all_other_perils_deductible: { type: ["number", "null"] },
      hurricane_deductible_pct: { type: ["number", "null"] },
      hurricane_deductible_amount: { type: ["number", "null"] },
      wind_hail_deductible_pct: { type: ["number", "null"] },
      flood_deductible: { type: ["number", "null"] },
      endorsements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: ["string", "null"] },
            limit: { type: ["number", "null"] },
          },
          required: ["name"],
        },
      },
      exclusions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: ["string", "null"] },
          },
          required: ["name"],
        },
      },
      summary: {
        type: "string",
        description:
          "2–4 sentence plain-language summary of coverage, key deductibles, and unusual endorsements or exclusions.",
      },
      confidence_notes: {
        type: "string",
        description:
          "Brief notes on what was unclear, partially-legible, or missing.",
      },
    },
    required: ["summary", "endorsements", "exclusions"],
  },
} as const;

const SYSTEM = `You are an expert insurance-policy analyst working for a public-adjusting firm.

Given a policy PDF (declaration page and any attached forms), extract the structured fields described in the save_policy_extraction tool schema.

Hard rules:
- Use the policy text only. Do not invent fields. Set unknown fields to null.
- Currency values are USD numbers without symbols or commas (e.g. 350000, not "$350,000").
- Hurricane / wind percent deductibles: report the percent number (e.g. 2 for 2%), not the dollar value, unless only the dollar value is shown.
- summary must be 2–4 sentences, plain language, and call out anything unusual: matching endorsement, ordinance & law tier, water-back-up, mold limits, screened-enclosure / roof limits, anti-concurrent-causation language.
- confidence_notes: if a section was illegible, was clearly missing from this PDF (e.g. only dec page provided), or values conflicted across pages, say so concretely.

You MUST call save_policy_extraction exactly once and emit no other text.`;

interface ExtractRequest {
  policy_id: number;
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

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);

  let body: ExtractRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body?.policy_id || typeof body.policy_id !== "number") {
    return json({ error: "policy_id (number) is required" }, 400);
  }

  // Read policy as the caller, so RLS enforces access.
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: policy, error: policyError } = await userClient
    .from("policies")
    .select("id, document_url")
    .eq("id", body.policy_id)
    .single();
  if (policyError || !policy) {
    return json(
      {
        error: "Policy not found or not accessible",
        detail: policyError?.message,
      },
      404,
    );
  }
  if (!policy.document_url) {
    return json(
      { error: "Policy has no document_url. Upload a PDF first." },
      400,
    );
  }

  // Download the PDF from the attachments bucket. The document_url stored
  // on the policy is the storage path inside the bucket (e.g.
  // "policies/42/policy.pdf"), not a public URL.
  const { data: blob, error: dlError } = await supabaseAdmin.storage
    .from("attachments")
    .download(policy.document_url);
  if (dlError || !blob) {
    return json(
      {
        error: "Failed to download policy PDF from storage",
        detail: dlError?.message,
      },
      500,
    );
  }
  const pdfBytes = new Uint8Array(await blob.arrayBuffer());
  const base64 = bytesToBase64(pdfBytes);

  // Call Anthropic with the PDF as a document content block.
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
      tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
      tools: [EXTRACTION_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: "Extract the structured fields from this insurance policy and call save_policy_extraction.",
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

  const anthropicJson = await anthropicRes.json();
  const toolUse = (anthropicJson?.content ?? []).find(
    (block: { type: string; name?: string }) =>
      block.type === "tool_use" && block.name === EXTRACTION_TOOL.name,
  );
  if (!toolUse) {
    return json(
      { error: "Model did not return a tool_use block", raw: anthropicJson },
      502,
    );
  }

  return json(
    {
      policy_id: body.policy_id,
      extraction: toolUse.input,
      model: ANTHROPIC_MODEL,
      usage: anthropicJson.usage,
    },
    200,
  );
});

// --- helpers ---

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid String.fromCharCode.apply(null, [...big array...]) which overflows.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
