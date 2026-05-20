import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware } from "../_shared/authentication.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import {
  buildMessages,
  parsePolicyAnalysis,
  type PolicyAnalysisInput,
  validatePolicyInput,
} from "./policyAnalysis.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet";

async function analyzePolicy(input: PolicyAnalysisInput) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured for this function");
  }
  const model = Deno.env.get("POLICY_ANALYSIS_MODEL") ?? DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "CARE AI CRM - Policy Review",
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(input),
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${detail.slice(0, 500)}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned an empty completion");
  }
  return parsePolicyAnalysis(content);
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, async (req) => {
      if (req.method !== "POST") {
        return createErrorResponse(405, "Method Not Allowed");
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return createErrorResponse(400, "Request body must be valid JSON");
      }

      const validationError = validatePolicyInput(body);
      if (validationError) {
        return createErrorResponse(400, validationError);
      }

      try {
        const analysis = await analyzePolicy(body as PolicyAnalysisInput);
        return new Response(JSON.stringify({ analysis }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (error) {
        console.error("analyze_policy.error", error);
        return createErrorResponse(
          502,
          `Policy analysis failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }),
  ),
);
