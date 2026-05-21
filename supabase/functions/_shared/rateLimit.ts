// Simple per-user rate limit for the AI agent endpoints (Roadmap Stage 12).
// Caps how many agent runs one user can start per minute, guarding against
// runaway loops and unexpected AI cost. Uses the agent_runs table as the store.
import { supabaseAdmin } from "./supabaseAdmin.ts";

const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 30;

/** True if this user has started too many agent runs in the last minute. */
export async function isRateLimited(saleId: number | null): Promise<boolean> {
  if (saleId == null) return false;
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("triggered_by", saleId)
    .gte("created_at", since);
  return (count ?? 0) >= MAX_RUNS_PER_WINDOW;
}
