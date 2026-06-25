// System health check.
//
// GET or POST /functions/v1/system-health
// Auth: caller JWT (any authenticated CRM user).
//
// Returns booleans about which server-side integrations are configured
// — never the actual secret values. Used by the /integrations page to
// show staff what's wired up vs. what still needs setup.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Require auth so this isn't an open fingerprinting endpoint.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult } = await userClient.auth.getUser();
  if (!userResult?.user) return json({ error: "Invalid auth token" }, 401);

  // Check env var presence. NEVER return the value.
  const has = (name: string) => Boolean(Deno.env.get(name));

  return json({
    anthropic: {
      configured: has("ANTHROPIC_API_KEY"),
      model:
        Deno.env.get("ANTHROPIC_MODEL") ??
        Deno.env.get("ANTHROPIC_CHAT_MODEL") ??
        null,
    },
    google_oauth: {
      configured:
        has("GOOGLE_OAUTH_CLIENT_ID") && has("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri_configured: has("GMAIL_OAUTH_REDIRECT_URI"),
      app_url_configured: has("APP_URL"),
    },
    dropbox_oauth: {
      configured: has("DROPBOX_CLIENT_ID") && has("DROPBOX_CLIENT_SECRET"),
      redirect_uri_configured: has("DROPBOX_OAUTH_REDIRECT_URI"),
    },
    hailtrace: {
      configured:
        has("HAILTRACE_API_KEY") &&
        has("HAILTRACE_API_BASE") &&
        has("HAILTRACE_VERIFY_PATH"),
      base: Deno.env.get("HAILTRACE_API_BASE") ?? null,
    },
    cron: {
      secret_configured: has("CRON_SECRET"),
    },
    service_role: {
      configured: has("SUPABASE_SERVICE_ROLE_KEY"),
    },
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
