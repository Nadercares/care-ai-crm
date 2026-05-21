// agent — runs a single specialist agent for a claim (Roadmap Stage 2).
// The run is created immediately and processed in the background, so the
// browser gets a fast { runId } response and then polls agent_runs /
// agent_outputs for progress.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { executeAgentRun, startAgentRun } from "../_shared/agents/runner.ts";
import { SPECIALIST_IDS } from "../_shared/agents/registry.ts";

function runInBackground(promise: Promise<unknown>): void {
  const edgeRuntime = (
    globalThis as {
      EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
  } else {
    // Local fallback: still start the work; just don't block the response.
    promise.catch((e) => console.error("Background agent run failed:", e));
  }
}

async function handle(req: Request, saleId: number | null): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  let body: {
    agentType?: unknown;
    dealId?: unknown;
    input?: { instructions?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return createErrorResponse(400, "Request body must be valid JSON");
  }

  const agentType = String(body?.agentType ?? "");
  const dealId = Number(body?.dealId);
  const instructions =
    typeof body?.input?.instructions === "string"
      ? body.input.instructions
      : undefined;

  if (!SPECIALIST_IDS.includes(agentType)) {
    return createErrorResponse(
      400,
      `Unknown agent type. Valid types: ${SPECIALIST_IDS.join(", ")}`,
    );
  }
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return createErrorResponse(400, "A valid numeric 'dealId' is required");
  }

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .single();
  if (!deal) {
    return createErrorResponse(404, `Claim ${dealId} not found`);
  }

  const runId = await startAgentRun({
    agentType,
    dealId,
    triggeredBy: saleId,
    instructions,
  });
  runInBackground(
    executeAgentRun(runId).catch((e) =>
      console.error(`agent run ${runId} failed:`, e),
    ),
  );

  return new Response(
    JSON.stringify({ runId, agentType, dealId, status: "running" }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req, user) => {
        const sale = user ? await getUserSale(user) : null;
        if (!sale) return createErrorResponse(401, "Unauthorized");
        try {
          return await handle(req, sale.id);
        } catch (e) {
          console.error("agent function error:", e);
          return createErrorResponse(500, "Internal Server Error");
        }
      }),
    ),
  ),
);
