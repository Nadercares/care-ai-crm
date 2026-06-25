// List files in a claim's linked Dropbox folder.
//
// POST /functions/v1/dropbox-list
// Body: { claim_id: number } OR { folder_path: string }
// Auth: caller JWT.
//
// Process:
//   1. Resolve caller → sales row → dropbox_connections.
//   2. Refresh the access token if expired (Dropbox short-lives them
//      to ~4h; we cache and refresh).
//   3. Resolve folder path: from claim_dropbox_folders.folder_path if
//      claim_id was given, else use body.folder_path.
//   4. Call Dropbox /2/files/list_folder.
//   5. Optionally request shared links so the UI can deep-link
//      directly (we use Dropbox's "preview" link pattern instead —
//      simpler and doesn't require permission to share-create).
//   6. Return entries with extension-based kind hints (no AI here —
//      a follow-up AI-classification path comes next session).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CLIENT_ID = Deno.env.get("DROPBOX_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("DROPBOX_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

interface Body {
  claim_id?: number;
  folder_path?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET)
    return json({ error: "Server missing Dropbox OAuth env vars" }, 500);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body?.claim_id && !body?.folder_path) {
    return json({ error: "claim_id or folder_path required" }, 400);
  }

  // Caller → sales.
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult?.user?.id;
  if (!userId) return json({ error: "Invalid auth token" }, 401);
  const { data: sales } = await userClient
    .from("sales")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (!sales) return json({ error: "No sales row for caller" }, 404);

  // Connection.
  const { data: connection } = await supabaseAdmin
    .from("dropbox_connections")
    .select(
      "id, refresh_token, access_token, access_token_expires_at, dropbox_email",
    )
    .eq("sales_id", sales.id)
    .single();
  if (!connection) {
    return json(
      { error: "Dropbox is not connected for this user. Connect it first." },
      400,
    );
  }

  // Folder path.
  let folderPath = body.folder_path ?? "";
  if (body.claim_id && !folderPath) {
    const { data: link } = await supabaseAdmin
      .from("claim_dropbox_folders")
      .select("folder_path")
      .eq("claim_id", body.claim_id)
      .maybeSingle();
    if (!link) {
      return json(
        {
          error:
            "No Dropbox folder is linked to this claim yet. Set one first.",
        },
        404,
      );
    }
    folderPath = link.folder_path;
  }
  // Dropbox expects paths starting with "/" (or "" for the root).
  folderPath = folderPath.trim();
  if (folderPath && !folderPath.startsWith("/")) folderPath = "/" + folderPath;

  // Refresh access token if needed.
  const accessToken = await ensureAccessToken(connection);

  // List.
  const listRes = await fetch(
    "https://api.dropboxapi.com/2/files/list_folder",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        path: folderPath,
        recursive: false,
        include_non_downloadable_files: false,
      }),
    },
  );
  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => "");
    return json(
      { error: `Dropbox ${listRes.status}`, detail: detail.slice(0, 500) },
      502,
    );
  }
  const listJson = (await listRes.json()) as {
    entries?: DropboxEntry[];
    has_more?: boolean;
  };

  const entries = (listJson.entries ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    path: e.path_display ?? e.path_lower ?? "",
    kind: e[".tag"], // 'file' | 'folder' | 'deleted'
    size: e.size ?? null,
    modified_at: e.server_modified ?? null,
    file_kind: e[".tag"] === "file" ? kindFromName(e.name) : null,
    preview_url:
      e[".tag"] === "file"
        ? `https://www.dropbox.com/preview${e.path_display ?? e.path_lower ?? ""}`
        : `https://www.dropbox.com/home${e.path_display ?? e.path_lower ?? ""}`,
  }));

  return json({
    folder_path: folderPath || "/",
    has_more: listJson.has_more === true,
    count: entries.length,
    entries,
  });
});

// --- helpers ---

interface DropboxEntry {
  ".tag": "file" | "folder" | "deleted";
  id: string;
  name: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  server_modified?: string;
}

async function ensureAccessToken(connection: {
  id: number;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}): Promise<string> {
  // If we have an unexpired access token, use it.
  if (
    connection.access_token &&
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() > Date.now()
  ) {
    return connection.access_token;
  }
  // Otherwise refresh.
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Refresh failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const tokens = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token)
    throw new Error("No access_token in refresh response");

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from("dropbox_connections")
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return tokens.access_token;
}

// Lightweight extension-based file-kind hint. AI classification is a
// follow-up — this is good enough for showing badges on the file list.
function kindFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    if (/(policy|declaration|dec[\s_-]*page|hp)/i.test(lower)) return "policy";
    if (/(estimate|xact|symbility|core[\s_-]*logic)/i.test(lower))
      return "estimate";
    if (/(report|engineer|moisture|inspection)/i.test(lower)) return "report";
    if (
      /(corresp|letter|email|denial|approval|denial[\s_-]*letter)/i.test(lower)
    )
      return "correspondence";
    if (/(contract|agreement|loa|assignment)/i.test(lower)) return "contract";
    return "document";
  }
  if (/\.(jpe?g|png|heic|webp|tif?f|gif)$/i.test(lower)) return "photo";
  if (/\.(mp4|mov|avi|webm)$/i.test(lower)) return "video";
  if (/\.(xlsx?|csv|numbers)$/i.test(lower)) return "spreadsheet";
  if (/\.(docx?|pages|rtf|txt|md)$/i.test(lower)) return "document";
  if (/\.(eml|msg)$/i.test(lower)) return "email";
  return "other";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
