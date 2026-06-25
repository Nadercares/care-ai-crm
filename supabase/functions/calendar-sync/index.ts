// Pull upcoming Google Calendar events for the caller, classify each
// with AI, match to CRM claims/carriers/adjusters, and upsert into
// public.calendar_events.
//
// POST /functions/v1/calendar-sync
// Body (optional): { lookahead_days?: number, max_events?: number }
// Auth: caller JWT.
//
// Events created via schedule-inspection already carry our
// extendedProperties.private.care_ai_claim_id — we honor that and
// skip the AI step for those rows. Manually-created events (or events
// from other tools) are sent to Claude for classification with a
// lookup pack of recent claims + carriers + carrier_adjusters.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_CALENDAR_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const MATCH_TOOL = {
  name: "save_calendar_matches",
  description:
    "For each calendar event in the batch, classify the kind and link to CRM records when clear.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            google_event_id: { type: "string" },
            kind: {
              type: "string",
              enum: [
                "inspection",
                "reinspection",
                "appraisal",
                "mediation",
                "carrier_meeting",
                "insured_meeting",
                "deadline",
                "other",
              ],
            },
            claim_id: { type: ["number", "null"] },
            contact_id: { type: ["number", "null"] },
            carrier_adjuster_id: { type: ["number", "null"] },
            ai_confidence: { type: "number" },
            ai_rationale: { type: "string" },
          },
          required: [
            "google_event_id",
            "kind",
            "ai_confidence",
            "ai_rationale",
          ],
        },
      },
    },
    required: ["events"],
  },
} as const;

const SYSTEM = `You classify calendar events for a public-adjusting firm.

For each event in the batch return:
  - kind: inspection | reinspection | appraisal | mediation | carrier_meeting | insured_meeting | deadline | other
  - claim_id / contact_id / carrier_adjuster_id from the lookup pack, or null. NEVER invent ids.
  - ai_confidence (0.0–1.0) and ai_rationale (cite the specific name / claim number / address you matched on).

Matching cues:
  - Address in event location matches a claim's loss_location_address.
  - Insured name in summary/description matches a contacts row.
  - Carrier adjuster name or email matches a carrier_adjusters row.
  - Date pattern + claim status (inspection_scheduled etc.).

You MUST call save_calendar_matches exactly once.`;

interface Body {
  lookahead_days?: number;
  max_events?: number;
}

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

  let body: Body = {};
  try {
    body = ((await req.json()) ?? {}) as Body;
  } catch {
    // empty body is fine
  }
  const lookaheadDays = clamp(body.lookahead_days ?? 30, 1, 365);
  const maxEvents = clamp(body.max_events ?? 100, 1, 250);

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

  const { data: connection } = await supabaseAdmin
    .from("gmail_connections")
    .select("refresh_token, scopes")
    .eq("sales_id", sales.id)
    .single();
  if (!connection) {
    return json(
      { error: "Google not connected. Connect on /email-triage first." },
      400,
    );
  }
  if (!connection.scopes?.includes(REQUIRED_SCOPE)) {
    return json(
      {
        error:
          "Google connection lacks calendar.events scope. Reconnect to grant it.",
      },
      400,
    );
  }

  const accessToken = await refreshAccessToken(connection.refresh_token);

  // Pull upcoming events.
  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + lookaheadDays * 86_400_000,
  ).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxEvents),
  });
  const listRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => "");
    return json(
      {
        error: `Calendar list ${listRes.status}`,
        detail: detail.slice(0, 500),
      },
      502,
    );
  }
  const listJson = (await listRes.json()) as { items?: GoogleEvent[] };
  const events = listJson.items ?? [];

  if (events.length === 0) {
    return json({ synced: 0, classified: 0, total: 0 });
  }

  // Honour CARE-AI-created events: kind + claim already in extended
  // properties. Just upsert their basics.
  const ourOwn: GoogleEvent[] = [];
  const needClassify: GoogleEvent[] = [];
  for (const ev of events) {
    const claimIdProp = ev.extendedProperties?.private?.care_ai_claim_id;
    if (claimIdProp) ourOwn.push(ev);
    else needClassify.push(ev);
  }

  // For events not created by us, ask Claude.
  let classifiedRows: ClassifiedRow[] = [];
  if (needClassify.length > 0) {
    const [recentClaims, contacts, carrierAdjusters] = await Promise.all([
      supabaseAdmin
        .from("claims")
        .select(
          "id, claim_number, internal_claim_number, status, contact_id, carrier_id, loss_location_address, loss_location_city, loss_location_state",
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
        .select("id, carrier_id, first_name, last_name, email")
        .limit(500),
    ]);
    const lookup = {
      claims: recentClaims.data ?? [],
      contacts: contacts.data ?? [],
      carrier_adjusters: carrierAdjusters.data ?? [],
    };
    const compact = needClassify.map(compactEvent);

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
        tool_choice: { type: "tool", name: MATCH_TOOL.name },
        tools: [MATCH_TOOL],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Lookup pack:\n\n```json\n" +
                  JSON.stringify(lookup) +
                  "\n```\n\nEvents to classify:\n\n```json\n" +
                  JSON.stringify(compact) +
                  "\n```\n\nCall save_calendar_matches.",
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
    const toolUse = (reply?.content ?? []).find(
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === MATCH_TOOL.name,
    );
    if (!toolUse) {
      return json({ error: "Model did not return a tool_use block" }, 502);
    }
    classifiedRows = (toolUse.input?.events ?? []) as ClassifiedRow[];
  }

  // Upsert.
  const classifiedById = new Map(
    classifiedRows.map((c) => [c.google_event_id, c]),
  );
  const rows = [
    ...ourOwn.map((ev) => ({
      sales_id: sales.id,
      google_event_id: ev.id,
      google_calendar_id: "primary",
      ical_uid: ev.iCalUID ?? null,
      html_link: ev.htmlLink ?? null,
      summary: ev.summary ?? null,
      description: ev.description ?? null,
      location: ev.location ?? null,
      starts_at: ev.start?.dateTime ?? ev.start?.date ?? null,
      ends_at: ev.end?.dateTime ?? ev.end?.date ?? null,
      all_day: !ev.start?.dateTime,
      kind: ev.extendedProperties?.private?.care_ai_kind ?? "other",
      claim_id: Number(ev.extendedProperties?.private?.care_ai_claim_id),
      status: ev.status === "cancelled" ? "cancelled" : "scheduled",
      source: "created",
      updated_at: new Date().toISOString(),
    })),
    ...needClassify.map((ev) => {
      const c = classifiedById.get(ev.id);
      return {
        sales_id: sales.id,
        google_event_id: ev.id,
        google_calendar_id: "primary",
        ical_uid: ev.iCalUID ?? null,
        html_link: ev.htmlLink ?? null,
        summary: ev.summary ?? null,
        description: ev.description ?? null,
        location: ev.location ?? null,
        starts_at: ev.start?.dateTime ?? ev.start?.date ?? null,
        ends_at: ev.end?.dateTime ?? ev.end?.date ?? null,
        all_day: !ev.start?.dateTime,
        kind: c?.kind ?? "other",
        claim_id: c?.claim_id ?? null,
        contact_id: c?.contact_id ?? null,
        carrier_adjuster_id: c?.carrier_adjuster_id ?? null,
        ai_confidence: c?.ai_confidence ?? null,
        ai_rationale: c?.ai_rationale ?? null,
        status: ev.status === "cancelled" ? "cancelled" : "scheduled",
        source: "synced",
        updated_at: new Date().toISOString(),
      };
    }),
  ];

  if (rows.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("calendar_events")
      .upsert(rows, { onConflict: "sales_id,google_event_id" });
    if (upsertError) {
      return json(
        {
          error: "Failed to upsert calendar_events",
          detail: upsertError.message,
        },
        500,
      );
    }
  }

  return json({
    synced: rows.length,
    classified: classifiedRows.length,
    total: events.length,
  });
});

// --- helpers ---

interface GoogleEvent {
  id: string;
  iCalUID?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

interface ClassifiedRow {
  google_event_id: string;
  kind: string;
  claim_id?: number | null;
  contact_id?: number | null;
  carrier_adjuster_id?: number | null;
  ai_confidence: number;
  ai_rationale: string;
}

function compactEvent(ev: GoogleEvent) {
  return {
    google_event_id: ev.id,
    summary: ev.summary ?? null,
    description: ev.description?.slice(0, 1500) ?? null,
    location: ev.location ?? null,
    start: ev.start?.dateTime ?? ev.start?.date ?? null,
    attendees: (ev.attendees ?? []).map((a) => a.email).filter(Boolean),
  };
}

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
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("No access_token in refresh response");
  return j.access_token;
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
