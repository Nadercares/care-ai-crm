// Gmail OAuth callback.
//
// Google redirects the user here after they click "Allow" on the
// Google consent screen for our Gmail scopes. We exchange the code for
// tokens, store the refresh_token keyed to the calling sales user,
// then bounce them back to the CRM's /email-triage page.
//
// Configure on the Google Cloud side:
//   - Redirect URI:
//       https://<project-ref>.supabase.co/functions/v1/gmail-oauth-callback
//   - Scopes:
//       https://www.googleapis.com/auth/gmail.readonly
//       https://www.googleapis.com/auth/gmail.modify   (next session — drafts)
//       https://www.googleapis.com/auth/userinfo.email (to know who connected)
//
// Required Supabase function secrets:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GMAIL_OAUTH_REDIRECT_URI  (must match Google Cloud config exactly)
//   APP_URL                   (where to bounce the user back, e.g. https://crm.careai.example)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("GMAIL_OAUTH_REDIRECT_URI") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

Deno.serve(async (req) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !APP_URL) {
    return redirectWithError(
      "Server misconfigured: missing Google OAuth env vars.",
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectWithError(`Google returned: ${error}`);
  }
  if (!code) {
    return redirectWithError("Missing code parameter.");
  }
  if (!state) {
    return redirectWithError("Missing state parameter (caller user id).");
  }

  // `state` is a Supabase auth user id (uuid) set by the frontend
  // when initiating the OAuth flow. We resolve it back to the sales
  // row id here.
  const { data: sales, error: salesError } = await supabaseAdmin
    .from("sales")
    .select("id")
    .eq("user_id", state)
    .single();
  if (salesError || !sales) {
    return redirectWithError(
      `Could not match Google state to a CRM sales user (${state}).`,
    );
  }

  // Exchange code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    return redirectWithError(
      `Token exchange failed (${tokenRes.status}): ${detail.slice(0, 200)}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!tokens.refresh_token) {
    // Google only returns a refresh_token on FIRST consent. If the user
    // already granted before, they need to revoke + reconsent (prompt=consent
    // in the auth URL forces this; the frontend sets it).
    return redirectWithError(
      "Google did not return a refresh_token. Reconnect with prompt=consent or revoke prior access at https://myaccount.google.com/permissions and retry.",
    );
  }

  // Get the connected Google email.
  let googleEmail: string | null = null;
  try {
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { email?: string };
      googleEmail = me.email ?? null;
    }
  } catch {
    // non-fatal — we'll just leave email blank
  }

  if (!googleEmail) {
    return redirectWithError("Could not read connected Google email.");
  }

  const scopes = tokens.scope ? tokens.scope.split(" ") : [];

  const { error: upsertError } = await supabaseAdmin
    .from("gmail_connections")
    .upsert(
      {
        sales_id: sales.id,
        google_email: googleEmail,
        refresh_token: tokens.refresh_token,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sales_id" },
    );

  if (upsertError) {
    return redirectWithError(
      `Failed to save Gmail connection: ${upsertError.message}`,
    );
  }

  return Response.redirect(
    `${APP_URL.replace(/\/$/, "")}/email-triage?gmail_connected=1`,
    302,
  );
});

function redirectWithError(message: string): Response {
  const target = `${APP_URL.replace(/\/$/, "")}/email-triage?gmail_error=${encodeURIComponent(message)}`;
  return Response.redirect(target, 302);
}
