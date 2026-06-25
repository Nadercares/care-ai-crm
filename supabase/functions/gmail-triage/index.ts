// Gmail triage runner.
//
// POST /functions/v1/gmail-triage
// Body: { sales_id?: number, limit?: number }   (sales_id defaults to
//        the calling user; limit defaults to 25, max 100)
// Auth: caller JWT (the connected Gmail user, or any staff member
//        running triage on behalf of one).
//
// Process:
//   1. Resolve sales_id (caller's own if not specified).
//   2. Read the refresh_token from gmail_connections.
//   3. Exchange refresh_token → access_token at Google.
//   4. Fetch the N most recent inbox threads via Gmail API.
//   5. For each thread we have NOT yet triaged (no row in email_triage
//      with this gmail_thread_id), fetch the latest message and build
//      a compact representation.
//   6. Send the batch to Claude with a lookup pack of (carriers,
//      recent claims, recent contacts) and force a single tool call
//      that classifies every thread.
//   7. Upsert the classifications to email_triage.
//   8. Stamp last_synced_at + status on gmail_connections.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_TRIAGE_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const BODY_EXCERPT_BYTES = 4_000;

const TRIAGE_TOOL = {
  name: "save_triage_batch",
  description:
    "Classify every Gmail thread in the input batch and return a structured row for each.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      threads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gmail_thread_id: { type: "string" },
            classification: {
              type: "string",
              enum: [
                "claim_correspondence",
                "new_lead",
                "admin",
                "marketing",
                "spam",
                "unknown",
              ],
            },
            urgency: { type: "string", enum: ["high", "medium", "low"] },
            summary: {
              type: "string",
              description: "1–2 sentences. What this email says and why.",
            },
            suggested_action: {
              type: "string",
              description:
                "One concrete next step a staffer should take. No legal advice.",
            },
            claim_id: { type: ["number", "null"] },
            contact_id: { type: ["number", "null"] },
            carrier_id: { type: ["number", "null"] },
            carrier_adjuster_id: { type: ["number", "null"] },
            ai_confidence: {
              type: "number",
              description: "0.0–1.0 confidence in the CRM-record matches.",
            },
            ai_rationale: {
              type: "string",
              description:
                "Why the matches were made. Cite the specific name / number / domain pattern.",
            },
          },
          required: [
            "gmail_thread_id",
            "classification",
            "urgency",
            "summary",
            "suggested_action",
            "ai_confidence",
            "ai_rationale",
          ],
        },
      },
    },
    required: ["threads"],
  },
} as const;

const SYSTEM = `You triage email for a public-adjusting firm.

For each Gmail thread in the input batch, decide:
  - classification: claim_correspondence (a known claim or one of our insureds), new_lead (potential new claim from someone we don't have yet), admin (internal ops, vendor invoices, etc.), marketing, spam, unknown.
  - urgency: high (deadline / denial letter / appraisal demand / suit served / time-bar mention), medium (substantive but routine), low (FYI).
  - summary (1–2 sentences).
  - suggested_action (one concrete next step the staffer should take). No legal advice.
  - CRM matches: claim_id, contact_id, carrier_id, carrier_adjuster_id — pulled from the lookup pack. If no match is clear, return null. NEVER invent ids.
  - ai_confidence (0.0–1.0) and ai_rationale (cite the specific carrier domain, claim number, or insured name you matched on).

Matching rules:
  - Carrier match: sender domain matches a known carrier domain, or sender name matches a carrier_adjusters row's name/email, or body mentions a carrier and a claim number we have.
  - Claim match: explicit claim number in subject or body, or insured name + carrier match.
  - If the carrier matches but the specific claim doesn't, return the carrier_id and leave claim_id null.

You MUST call save_triage_batch exactly once.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY)
    return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);
  if (!CLIENT_ID || !CLIENT_SECRET)
    return json({ error: "Server missing Google OAuth env vars" }, 500);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);

  let body: { sales_id?: number; limit?: number };
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  // Resolve caller → sales row.
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult?.user?.id;
  if (!userId) return json({ error: "Invalid auth token" }, 401);

  let salesId = body.sales_id;
  if (!salesId) {
    const { data: sales } = await userClient
      .from("sales")
      .select("id")
      .eq("user_id", userId)
      .single();
    if (!sales) return json({ error: "No sales row for caller" }, 404);
    salesId = sales.id;
  }

  // Load the connection (service role bypasses RLS — we already
  // authenticated the caller above).
  const { data: connection, error: connError } = await supabaseAdmin
    .from("gmail_connections")
    .select("id, sales_id, google_email, refresh_token")
    .eq("sales_id", salesId)
    .single();
  if (connError || !connection) {
    return json(
      { error: "Gmail is not connected for this user. Connect it first." },
      400,
    );
  }

  // Mark running.
  await supabaseAdmin
    .from("gmail_connections")
    .update({ last_sync_status: "running", last_sync_error: null })
    .eq("id", connection.id);

  try {
    const accessToken = await refreshAccessToken(connection.refresh_token);
    const limit = clamp(body.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
    const threads = await listInboxThreads(accessToken, limit);

    // Skip threads we've already triaged.
    const threadIds = threads.map((t) => t.id);
    const { data: existing } = await supabaseAdmin
      .from("email_triage")
      .select("gmail_thread_id")
      .eq("sales_id", salesId)
      .in("gmail_thread_id", threadIds);
    const alreadyTriaged = new Set(
      (existing ?? []).map((r) => r.gmail_thread_id),
    );
    const fresh = threads.filter((t) => !alreadyTriaged.has(t.id));

    if (fresh.length === 0) {
      await supabaseAdmin
        .from("gmail_connections")
        .update({
          last_sync_status: "ok",
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
      return json({
        triaged: 0,
        skipped: threads.length,
        total: threads.length,
      });
    }

    // Pull each fresh thread's latest message.
    const enriched = await Promise.all(
      fresh.map((t) => fetchThreadDetail(accessToken, t.id)),
    );

    // Lookup pack for AI matching. Capped per list — we trust matching
    // by name/domain/number, not by handing the model the whole CRM.
    const [carriers, recentClaims, recentContacts, carrierAdjusters] =
      await Promise.all([
        supabaseAdmin
          .from("carriers")
          .select("id, name, naic_code, claims_email")
          .limit(500),
        supabaseAdmin
          .from("claims")
          .select(
            "id, claim_number, internal_claim_number, date_of_loss, status, contact_id, carrier_id",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabaseAdmin
          .from("contacts")
          .select("id, first_name, last_name, email")
          .order("last_seen", { ascending: false, nullsFirst: false })
          .limit(500),
        supabaseAdmin
          .from("carrier_adjusters")
          .select(
            "id, carrier_id, first_name, last_name, email, license_number, role",
          )
          .limit(500),
      ]);

    const lookup = {
      carriers: carriers.data ?? [],
      claims: recentClaims.data ?? [],
      contacts: recentContacts.data ?? [],
      carrier_adjusters: carrierAdjusters.data ?? [],
    };

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
        tools: [TRIAGE_TOOL],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Lookup pack (CRM records you may match to):\n\n```json\n" +
                  JSON.stringify(lookup) +
                  "\n```\n\nThreads to triage:\n\n```json\n" +
                  JSON.stringify(enriched) +
                  "\n```\n\nCall save_triage_batch with one row per thread.",
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text().catch(() => "");
      throw new Error(
        `Anthropic ${anthropicRes.status}: ${detail.slice(0, 300)}`,
      );
    }
    const reply = await anthropicRes.json();
    const toolUse = (reply?.content ?? []).find(
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === TRIAGE_TOOL.name,
    );
    if (!toolUse) throw new Error("Model did not return a tool_use block");

    const triaged = (toolUse.input?.threads ?? []) as Array<{
      gmail_thread_id: string;
      classification: string;
      urgency: string;
      summary: string;
      suggested_action: string;
      claim_id?: number | null;
      contact_id?: number | null;
      carrier_id?: number | null;
      carrier_adjuster_id?: number | null;
      ai_confidence: number;
      ai_rationale: string;
    }>;

    // Build rows by joining AI output with the enriched thread metadata.
    const enrichedById = new Map(enriched.map((e) => [e.id, e]));
    const rows = triaged
      .map((t) => {
        const meta = enrichedById.get(t.gmail_thread_id);
        if (!meta) return null;
        return {
          sales_id: salesId,
          gmail_thread_id: t.gmail_thread_id,
          latest_message_id: meta.latest_message_id,
          subject: meta.subject,
          from_email: meta.from_email,
          from_name: meta.from_name,
          snippet: meta.snippet,
          body_excerpt: meta.body_excerpt,
          received_at: meta.received_at,
          claim_id: t.claim_id ?? null,
          contact_id: t.contact_id ?? null,
          carrier_id: t.carrier_id ?? null,
          carrier_adjuster_id: t.carrier_adjuster_id ?? null,
          classification: t.classification,
          urgency: t.urgency,
          summary: t.summary,
          suggested_action: t.suggested_action,
          ai_confidence: t.ai_confidence,
          ai_rationale: t.ai_rationale,
          status: "new",
        };
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("email_triage")
        .upsert(rows, { onConflict: "sales_id,gmail_thread_id" });
      if (insertError) throw new Error(`DB insert: ${insertError.message}`);
    }

    await supabaseAdmin
      .from("gmail_connections")
      .update({
        last_sync_status: "ok",
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return json({
      triaged: rows.length,
      skipped: alreadyTriaged.size,
      total: threads.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("gmail_connections")
      .update({ last_sync_status: "error", last_sync_error: msg })
      .eq("id", connection.id);
    return json({ error: msg }, 500);
  }
});

// --- Google API helpers ---

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Refresh failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token)
    throw new Error("No access_token in refresh response");
  return json.access_token;
}

async function listInboxThreads(
  accessToken: string,
  limit: number,
): Promise<Array<{ id: string }>> {
  const params = new URLSearchParams({
    labelIds: "INBOX",
    maxResults: String(limit),
  });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `List threads failed (${res.status}): ${detail.slice(0, 200)}`,
    );
  }
  const j = (await res.json()) as { threads?: Array<{ id: string }> };
  return j.threads ?? [];
}

interface ThreadDetail {
  id: string;
  latest_message_id: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  snippet: string | null;
  body_excerpt: string | null;
  received_at: string | null;
}

async function fetchThreadDetail(
  accessToken: string,
  threadId: string,
): Promise<ThreadDetail> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    return {
      id: threadId,
      latest_message_id: null,
      subject: null,
      from_email: null,
      from_name: null,
      snippet: null,
      body_excerpt: null,
      received_at: null,
    };
  }
  const data = (await res.json()) as GmailThread;
  const messages = data.messages ?? [];
  const latest = messages[messages.length - 1];
  if (!latest)
    return {
      id: threadId,
      latest_message_id: null,
      subject: null,
      from_email: null,
      from_name: null,
      snippet: null,
      body_excerpt: null,
      received_at: null,
    };
  const headers = new Map(
    (latest.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  const from = headers.get("from") ?? "";
  const subject = headers.get("subject") ?? null;
  const dateHeader = headers.get("date") ?? null;
  const { name: fromName, email: fromEmail } = parseFromHeader(from);
  const body = extractTextBody(latest.payload);
  const bodyExcerpt = body ? body.slice(0, BODY_EXCERPT_BYTES) : null;
  return {
    id: threadId,
    latest_message_id: latest.id ?? null,
    subject,
    from_email: fromEmail,
    from_name: fromName,
    snippet: data.snippet ?? null,
    body_excerpt: bodyExcerpt,
    received_at: dateHeader ? new Date(dateHeader).toISOString() : null,
  };
}

interface GmailThread {
  snippet?: string;
  messages?: Array<{
    id?: string;
    payload?: GmailPayload;
  }>;
}
interface GmailPayload {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
}

function parseFromHeader(value: string): {
  name: string | null;
  email: string | null;
} {
  const match = value.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/"/g, "").trim() || null,
      email: match[2].trim(),
    };
  }
  return { name: null, email: value.trim() || null };
}

function extractTextBody(payload?: GmailPayload): string | null {
  if (!payload) return null;
  if (payload.body?.data && payload.mimeType?.startsWith("text/")) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  for (const part of payload.parts ?? []) {
    const nested = extractTextBody(part);
    if (nested) return nested;
  }
  return null;
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
  } catch {
    return "";
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
