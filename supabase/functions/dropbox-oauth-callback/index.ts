// Dropbox OAuth callback.
//
// Dropbox redirects the user here after they approve the firm's
// Dropbox app. We exchange the code for tokens (Dropbox returns
// short-lived access_token + long-lived refresh_token when
// token_access_type=offline was set on the auth URL), upsert the
// dropbox_connections row keyed to the calling sales user, and bounce
// the staffer back to the claim they were on (state carries it) or
// to the claims list.
//
// Required Supabase function secrets:
//   DROPBOX_CLIENT_ID
//   DROPBOX_CLIENT_SECRET
//   DROPBOX_OAUTH_REDIRECT_URI   (must match Dropbox app settings exactly)
//   APP_URL                       (where to bounce back)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CLIENT_ID = Deno.env.get("DROPBOX_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("DROPBOX_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("DROPBOX_OAUTH_REDIRECT_URI") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

Deno.serve(async (req) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !APP_URL) {
    return redirectWithError(
      "Server misconfigured: missing Dropbox OAuth env vars.",
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirectWithError(`Dropbox returned: ${error}`);
  if (!code) return redirectWithError("Missing code parameter.");
  if (!state)
    return redirectWithError("Missing state (caller user id / claim id).");

  // state encoding: "<auth_user_id>|<optional_claim_id>"
  const [authUserId, rawClaimId] = state.split("|");
  const claimId = rawClaimId ? Number(rawClaimId) : null;

  const { data: sales, error: salesError } = await supabaseAdmin
    .from("sales")
    .select("id")
    .eq("user_id", authUserId)
    .single();
  if (salesError || !sales) {
    return redirectWithError(
      `Could not match Dropbox state to a CRM sales user (${authUserId}).`,
    );
  }

  // Exchange code.
  const tokenRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
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
    expires_in?: number;
    account_id?: string;
    scope?: string;
    token_type?: string;
  };
  if (!tokens.refresh_token) {
    return redirectWithError(
      "Dropbox did not return a refresh_token. Make sure the auth URL includes token_access_type=offline and the user is re-consenting.",
    );
  }

  // Get account email.
  let email: string | null = null;
  try {
    const meRes = await fetch(
      "https://api.dropboxapi.com/2/users/get_current_account",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      },
    );
    if (meRes.ok) {
      const me = (await meRes.json()) as { email?: string };
      email = me.email ?? null;
    }
  } catch {
    // non-fatal
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
    : null;

  const { error: upsertError } = await supabaseAdmin
    .from("dropbox_connections")
    .upsert(
      {
        sales_id: sales.id,
        dropbox_account_id: tokens.account_id ?? null,
        dropbox_email: email,
        access_token: tokens.access_token ?? null,
        access_token_expires_at: expiresAt,
        refresh_token: tokens.refresh_token,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sales_id" },
    );

  if (upsertError) {
    return redirectWithError(
      `Failed to save Dropbox connection: ${upsertError.message}`,
    );
  }

  // Bounce: back to the claim if we know it, else to the claims list.
  const base = APP_URL.replace(/\/$/, "");
  const target =
    claimId && Number.isFinite(claimId)
      ? `${base}/claims/${claimId}/show?dropbox_connected=1`
      : `${base}/claims?dropbox_connected=1`;
  return Response.redirect(target, 302);
});

function redirectWithError(message: string): Response {
  const target = `${APP_URL.replace(/\/$/, "")}/claims?dropbox_error=${encodeURIComponent(message)}`;
  return Response.redirect(target, 302);
}
