// Scheduled calendar-sync runner.
//
// POST /functions/v1/calendar-sync-runner
// Headers: X-CRON-Secret: <CRON_SECRET env var>
// Body (optional): { lookahead_days?: number, max_events?: number,
//                    stale_minutes?: number }
//
// Mirrors gmail-triage-runner: iterates every gmail_connections row
// whose access_token has the calendar.events scope and dispatches
// /functions/v1/calendar-sync per user — service-role authed +
// X-Cron-Runner: true so the user-facing function skips JWT.
//
// The user-facing calendar-sync doesn't track its own last_synced_at
// on a per-connection field (the gmail_connections row is shared with
// Gmail triage), so this runner doesn't filter by staleness by default
// — it just dispatches every connection. If you want a poor-man's
// throttle, set stale_minutes and the runner will skip connections
// whose last_synced_at is newer than that floor.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/calendar.events";

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
  if ((req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Bad cron secret" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    lookahead_days?: number;
    max_events?: number;
    stale_minutes?: number;
  } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    // empty body fine
  }
  const lookaheadDays = Math.min(365, Math.max(1, body.lookahead_days ?? 30));
  const maxEvents = Math.min(250, Math.max(1, body.max_events ?? 100));
  const staleMinutes = body.stale_minutes ?? null;

  const { data: connections, error } = await supabaseAdmin
    .from("gmail_connections")
    .select("sales_id, google_email, scopes, last_synced_at")
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

  const eligible = (connections ?? []).filter(
    (c) => Array.isArray(c.scopes) && c.scopes.includes(REQUIRED_SCOPE),
  );

  // Optional throttle.
  const cutoff =
    staleMinutes !== null
      ? new Date(Date.now() - staleMinutes * 60_000).toISOString()
      : null;
  const toRun = cutoff
    ? eligible.filter((c) => !c.last_synced_at || c.last_synced_at < cutoff)
    : eligible;

  const results: Array<{
    sales_id: number;
    google_email: string;
    ok: boolean;
    synced?: number;
    classified?: number;
    total?: number;
    error?: string;
  }> = [];

  for (const conn of toRun) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "X-Cron-Runner": "true",
        },
        body: JSON.stringify({
          sales_id: conn.sales_id,
          lookahead_days: lookaheadDays,
          max_events: maxEvents,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        results.push({
          sales_id: conn.sales_id,
          google_email: conn.google_email,
          ok: false,
          error: payload?.error ?? `HTTP ${res.status}`,
        });
      } else {
        results.push({
          sales_id: conn.sales_id,
          google_email: conn.google_email,
          ok: true,
          synced: payload?.synced ?? 0,
          classified: payload?.classified ?? 0,
          total: payload?.total ?? 0,
        });
      }
    } catch (err) {
      results.push({
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
      considered: eligible.length,
      dispatched: toRun.length,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
