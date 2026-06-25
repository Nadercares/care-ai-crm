// Scheduled Gmail triage runner.
//
// POST /functions/v1/gmail-triage-runner
// Headers: X-CRON-Secret: <CRON_SECRET env var>
// Body (optional): { stale_minutes?: number, limit_per_user?: number }
//
// Iterates every gmail_connections row whose last_synced_at is older
// than `stale_minutes` (default 15) and dispatches the user-facing
// /functions/v1/gmail-triage endpoint for each, signed with the
// service-role key so it can act on behalf of any user.
//
// Auth: a shared CRON_SECRET header. This endpoint is intended to be
// called from pg_cron (via pg_net) or any external scheduler.
//
// Why dispatch rather than re-implementing the triage core here:
// keeping one implementation of "triage one user" in gmail-triage
// means there's one place to fix bugs and one prompt to tune.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface Body {
  stale_minutes?: number;
  limit_per_user?: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "Server missing CRON_SECRET" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Bad cron secret" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  try {
    body = ((await req.json()) ?? {}) as Body;
  } catch {
    // empty body is fine
  }
  const staleMinutes = Math.max(1, body.stale_minutes ?? 15);
  const limitPerUser = Math.max(1, Math.min(100, body.limit_per_user ?? 25));

  // Pick connections that haven't synced recently AND aren't currently
  // running. last_synced_at NULL = never synced yet, also eligible.
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: connections, error } = await supabaseAdmin
    .from("gmail_connections")
    .select("id, sales_id, google_email, last_synced_at, last_sync_status")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .neq("last_sync_status", "running")
    .limit(200);
  if (error) {
    return new Response(
      JSON.stringify({
        error: "Could not list connections",
        detail: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const summary: Array<{
    sales_id: number;
    google_email: string;
    ok: boolean;
    triaged?: number;
    total?: number;
    error?: string;
  }> = [];

  for (const conn of connections ?? []) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-triage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Service-role auth lets gmail-triage skip the JWT path —
          // the function still treats this as a privileged caller.
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "X-Cron-Runner": "true",
        },
        body: JSON.stringify({
          sales_id: conn.sales_id,
          limit: limitPerUser,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        summary.push({
          sales_id: conn.sales_id,
          google_email: conn.google_email,
          ok: false,
          error: payload?.error ?? `HTTP ${res.status}`,
        });
      } else {
        summary.push({
          sales_id: conn.sales_id,
          google_email: conn.google_email,
          ok: true,
          triaged: payload?.triaged ?? 0,
          total: payload?.total ?? 0,
        });
      }
    } catch (err) {
      summary.push({
        sales_id: conn.sales_id,
        google_email: conn.google_email,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ran_at: new Date().toISOString(),
      stale_minutes: staleMinutes,
      considered: connections?.length ?? 0,
      results: summary,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
