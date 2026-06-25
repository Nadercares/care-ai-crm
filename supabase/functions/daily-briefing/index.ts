// Daily morning briefing.
//
// POST /functions/v1/daily-briefing
// Body: { sales_id?: number, save_to_gmail?: boolean }
// Auth: caller JWT.
//
// Aggregates today's calendar, recently triaged email, stale/active
// claims, and recent carrier escalation patterns. Asks Claude for a
// structured markdown briefing that staff can read in 30 seconds.
// Optionally saves a copy as a Gmail draft addressed to the staffer's
// own inbox so they can read it on phone before getting to a laptop.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_BRIEFING_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STALE_DAYS = 14;
const ACTIVE_STATUSES = [
  "intake",
  "filed",
  "adjuster_assigned",
  "inspection_scheduled",
  "inspected",
  "estimate_pending",
  "negotiation",
  "partial_payment",
  "reopen",
  "appraisal",
  "mediation",
  "litigation",
];

const SYSTEM = `You are CARE AI writing a daily morning briefing for one staffer at a public-adjusting firm.

Write tight, scannable markdown. Lead with what's most likely to move money or risk today. Use these sections (omit any that are empty):

# Today
- One bullet per calendar event today: time · kind · claim ref · carrier · key fact from the description.

# Urgent inbox
- One bullet per high-urgency email_triage row from the last 24 hours. Include from, subject, and the AI-suggested action (verbatim if good).

# Stale claims
- One bullet per active claim with NO update in the past ${STALE_DAYS} days. Sort by oldest. State which carrier and what status it's stuck in.

# Carrier pattern shifts
- Comment on any carrier with a meaningful escalation rate, recent denials, or unusual avg_days_to_settle. Only call out something the staffer should actually do something about.

# Suggested first moves
- 3-5 ordered concrete actions for the staffer to take today, each tied to a specific claim or email. No vague "follow up" items.

Hard rules:
- No legal advice. No promises to carriers. No statute citations you weren't given.
- If a section has no input, omit it (do NOT write "Nothing today.").
- Keep it under 350 words.
- Use the staffer's first name once at the top ("Morning, Nader —").`;

interface Body {
  sales_id?: number;
  save_to_gmail?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY)
    return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }
  const userJwt = authHeader.slice("Bearer ".length);

  let body: Body = {};
  try {
    body = ((await req.json()) ?? {}) as Body;
  } catch {
    // empty body fine
  }

  // Two auth paths (same as gmail-triage).
  const isCronRunner =
    req.headers.get("x-cron-runner") === "true" &&
    SERVICE_ROLE_KEY !== "" &&
    userJwt === SERVICE_ROLE_KEY;

  let salesId = body.sales_id;
  let stafferFirstName = "";
  let stafferEmail = "";

  if (isCronRunner) {
    if (!salesId) return json({ error: "Cron runner needs sales_id" }, 400);
    const { data } = await supabaseAdmin
      .from("sales")
      .select("id, first_name, email")
      .eq("id", salesId)
      .single();
    if (!data) return json({ error: "sales_id not found" }, 404);
    stafferFirstName = data.first_name ?? "";
    stafferEmail = data.email ?? "";
  } else {
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userResult } = await userClient.auth.getUser();
    const userId = userResult?.user?.id;
    if (!userId) return json({ error: "Invalid auth token" }, 401);
    const { data: sales } = await userClient
      .from("sales")
      .select("id, first_name, email")
      .eq("user_id", userId)
      .single();
    if (!sales) return json({ error: "No sales row for caller" }, 404);
    salesId = sales.id;
    stafferFirstName = sales.first_name ?? "";
    stafferEmail = sales.email ?? "";
  }

  // Load context.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const triageFloor = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleFloor = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const [todayEvents, urgentEmails, staleClaims, carrierPatterns] =
    await Promise.all([
      supabaseAdmin
        .from("calendar_events")
        .select(
          "id, summary, location, starts_at, ends_at, kind, description, claim_id, status, html_link",
        )
        .eq("sales_id", salesId)
        .gte("starts_at", startOfDay.toISOString())
        .lte("starts_at", endOfDay.toISOString())
        .neq("status", "cancelled")
        .order("starts_at", { ascending: true })
        .limit(25),
      supabaseAdmin
        .from("email_triage")
        .select(
          "id, subject, from_name, from_email, urgency, classification, summary, suggested_action, received_at, claim_id, carrier_id",
        )
        .eq("sales_id", salesId)
        .gte("received_at", triageFloor.toISOString())
        .in("urgency", ["high", "medium"])
        .eq("status", "new")
        .order("received_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("claims_summary")
        .select(
          "id, claim_number, internal_claim_number, status, date_of_loss, updated_at, type_of_loss, cause_of_loss, contact_first_name, contact_last_name, carrier_name, loss_location_state",
        )
        .or(`sales_id.eq.${salesId},assigned_pa_sales_id.eq.${salesId}`)
        .in("status", ACTIVE_STATUSES)
        .lt("updated_at", staleFloor.toISOString())
        .order("updated_at", { ascending: true })
        .limit(20),
      supabaseAdmin
        .from("carrier_patterns_summary")
        .select(
          "carrier_name, claim_count, settled_count, avg_days_to_settle, count_escalated, count_with_attorney, count_denied, last_settlement_at",
        )
        .gt("claim_count", 0)
        .order("count_escalated", { ascending: false })
        .limit(8),
    ]);

  const inputs = {
    staffer: { first_name: stafferFirstName, email: stafferEmail },
    today_local_date: startOfDay.toISOString().slice(0, 10),
    today_events: todayEvents.data ?? [],
    urgent_emails_last_24h: urgentEmails.data ?? [],
    stale_claims_no_update_14d: staleClaims.data ?? [],
    carriers_with_activity: carrierPatterns.data ?? [],
  };

  // Generate.
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Inputs:\n\n```json\n" +
                JSON.stringify(inputs, null, 2) +
                "\n```\n\nWrite the briefing.",
            },
          ],
        },
      ],
    }),
  });
  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => "");
    return json(
      {
        error: `Anthropic ${anthropicRes.status}`,
        detail: detail.slice(0, 500),
      },
      502,
    );
  }
  const reply = await anthropicRes.json();
  const markdown =
    ((reply?.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim() || "(empty briefing)";

  // Counts for the response so the UI shows what the AI saw.
  const counts = {
    today_events: (todayEvents.data ?? []).length,
    urgent_emails: (urgentEmails.data ?? []).length,
    stale_claims: (staleClaims.data ?? []).length,
    carriers: (carrierPatterns.data ?? []).length,
  };

  // Optional: save as a Gmail draft to self.
  let gmailDraftId: string | null = null;
  let gmailSaveError: string | null = null;
  if (body.save_to_gmail && stafferEmail) {
    try {
      gmailDraftId = await saveBriefingAsGmailDraft({
        sales_id: salesId,
        to: stafferEmail,
        markdown,
      });
    } catch (err) {
      gmailSaveError = err instanceof Error ? err.message : String(err);
    }
  }

  return json({
    sales_id: salesId,
    generated_at: new Date().toISOString(),
    markdown,
    counts,
    saved_to_gmail: gmailDraftId !== null,
    gmail_draft_id: gmailDraftId,
    gmail_save_error: gmailSaveError,
    model: ANTHROPIC_MODEL,
    usage: reply.usage,
  });
});

// --- Gmail draft helper ---

async function saveBriefingAsGmailDraft(args: {
  sales_id: number;
  to: string;
  markdown: string;
}): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Google OAuth env vars missing");
  }
  const { data: connection } = await supabaseAdmin
    .from("gmail_connections")
    .select("refresh_token, scopes")
    .eq("sales_id", args.sales_id)
    .single();
  if (!connection) {
    throw new Error("Gmail is not connected for this user");
  }
  if (
    !connection.scopes?.includes("https://www.googleapis.com/auth/gmail.modify")
  ) {
    throw new Error("Gmail connection lacks gmail.modify scope; reconnect.");
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: connection.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok)
    throw new Error(`Token refresh failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("No access_token");

  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const subject = `CARE AI morning briefing — ${today}`;
  const mime = [
    `To: ${args.to}`,
    `From: ${args.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    args.markdown,
  ].join("\r\n");
  const raw = base64UrlEncode(mime);

  const draftRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ message: { raw } }),
    },
  );
  if (!draftRes.ok) {
    const detail = await draftRes.text().catch(() => "");
    throw new Error(
      `Gmail drafts.create ${draftRes.status}: ${detail.slice(0, 200)}`,
    );
  }
  const created = (await draftRes.json()) as { id?: string };
  if (!created.id) throw new Error("Gmail drafts.create returned no id");
  return created.id;
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
