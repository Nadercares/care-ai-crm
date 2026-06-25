// Scheduled daily-briefing runner.
//
// POST /functions/v1/daily-briefing-runner
// Headers: X-CRON-Secret: <CRON_SECRET env var>
// Body (optional): { save_to_gmail?: boolean }   (default true — the
//                   whole point of the cron is to land in their inbox)
//
// Iterates every sales user that has BOTH a sales row AND a
// gmail_connections row (so we know how to reach them) and dispatches
// /functions/v1/daily-briefing for each — service-role authed +
// X-Cron-Runner: true so the user-facing function skips JWT
// validation and trusts the sales_id in the body.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

  let body: { save_to_gmail?: boolean } = {};
  try {
    body = ((await req.json()) ?? {}) as { save_to_gmail?: boolean };
  } catch {
    // empty body fine
  }
  const saveToGmail = body.save_to_gmail !== false; // default true

  // Pick sales users that have a connected Gmail (so the saved draft
  // actually lands somewhere).
  const { data: connections, error } = await supabaseAdmin
    .from("gmail_connections")
    .select("sales_id, google_email")
    .limit(200);
  if (error) {
    return new Response(
      JSON.stringify({
        error: "Could not list gmail_connections",
        detail: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const results: Array<{
    sales_id: number;
    google_email: string;
    ok: boolean;
    saved_to_gmail?: boolean;
    error?: string;
  }> = [];

  for (const conn of connections ?? []) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-briefing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "X-Cron-Runner": "true",
        },
        body: JSON.stringify({
          sales_id: conn.sales_id,
          save_to_gmail: saveToGmail,
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
          saved_to_gmail: payload?.saved_to_gmail === true,
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
      considered: connections?.length ?? 0,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
