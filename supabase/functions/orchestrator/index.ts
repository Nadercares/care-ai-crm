// orchestrator — runs the Lead Orchestrator agent for a claim (Roadmap
// Stage 2). The orchestrator reviews the claim and delegates to the
// specialist agents it judges necessary. Like the agent function it returns
// a fast { runId } and processes the work in the background.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { executeAgentRun, startAgentRun } from "../_shared/agents/runner.ts";
import { isRateLimited } from "../_shared/rateLimit.ts";

function runInBackground(promise: Promise<unknown>): void {
  const edgeRuntime = (
    globalThis as {
      EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
  } else {
    promise.catch((e) => console.error("Background orchestration failed:", e));
  }
}

async function handle(req: Request, saleId: number | null): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  let body: { dealId?: unknown; input?: { instructions?: unknown } };
  try {
    body = await req.json();
  } catch {
    return createErrorResponse(400, "Request body must be valid JSON");
  }

  const dealId = Number(body?.dealId);
  const instructions =
    typeof body?.input?.instructions === "string"
      ? body.input.instructions.slice(0, 4000)
      : undefined;

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

  if (await isRateLimited(saleId)) {
    return createErrorResponse(
      429,
      "Too many agent runs in the last minute. Please wait a moment and try again.",
    );
  }

  const runId = await startAgentRun({
    agentType: "orchestrator",
    dealId,
    triggeredBy: saleId,
    instructions,
  });
  runInBackground(
    executeAgentRun(runId).catch((e) =>
      console.error(`orchestration run ${runId} failed:`, e),
    ),
  );

  return new Response(
    JSON.stringify({
      runId,
      agentType: "orchestrator",
      dealId,
      status: "running",
    }),
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
          console.error("orchestrator function error:", e);
          return createErrorResponse(500, "Internal Server Error");
        }
      }),
    ),
  ),
);
