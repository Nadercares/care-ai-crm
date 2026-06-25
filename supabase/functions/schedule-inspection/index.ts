// Create a Google Calendar event for a claim and persist it.
//
// POST /functions/v1/schedule-inspection
// Body: {
//   claim_id: number,
//   when: string,                  // ISO 8601 datetime, e.g. "2026-07-02T10:00:00-04:00"
//   duration_minutes?: number,      // default 60
//   kind?: "inspection" | "reinspection" | "appraisal" | "mediation"
//        | "carrier_meeting" | "insured_meeting" | "deadline" | "other",
//   attendees?: string[],          // extra email addresses to invite
//   location_override?: string,    // overrides loss address
//   additional_notes?: string,
// }
// Auth: caller JWT.
//
// Builds a context-rich Google Calendar event, POSTs it via the
// Calendar API using the calendar.events scope on the existing
// gmail_connections row, then upserts a public.calendar_events row
// linking google_event_id → claim_id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/calendar.events";

interface Body {
  claim_id: number;
  when: string;
  duration_minutes?: number;
  kind?: string;
  attendees?: string[];
  location_override?: string;
  additional_notes?: string;
}

const VALID_KINDS = new Set([
  "inspection",
  "reinspection",
  "appraisal",
  "mediation",
  "carrier_meeting",
  "insured_meeting",
  "deadline",
  "other",
]);

const KIND_LABEL: Record<string, string> = {
  inspection: "Inspection",
  reinspection: "Re-inspection",
  appraisal: "Appraisal",
  mediation: "Mediation",
  carrier_meeting: "Carrier meeting",
  insured_meeting: "Insured meeting",
  deadline: "Deadline",
  other: "Meeting",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET)
    return json({ error: "Server missing Google OAuth env vars" }, 500);

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
  if (!body?.claim_id || typeof body.claim_id !== "number")
    return json({ error: "claim_id (number) is required" }, 400);
  if (!body?.when || typeof body.when !== "string")
    return json({ error: "when (ISO datetime string) is required" }, 400);

  const startDate = new Date(body.when);
  if (Number.isNaN(startDate.getTime()))
    return json({ error: "when is not a valid ISO datetime" }, 400);
  const durationMin = clamp(body.duration_minutes ?? 60, 5, 12 * 60);
  const endDate = new Date(startDate.getTime() + durationMin * 60_000);
  const kind =
    body.kind && VALID_KINDS.has(body.kind) ? body.kind : "inspection";

  // Resolve caller → sales.
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult?.user?.id;
  if (!userId) return json({ error: "Invalid auth token" }, 401);
  const { data: sales } = await userClient
    .from("sales")
    .select("id, first_name, last_name, email")
    .eq("user_id", userId)
    .single();
  if (!sales) return json({ error: "No sales row for caller" }, 404);

  // Connection + scope check.
  const { data: connection } = await supabaseAdmin
    .from("gmail_connections")
    .select("refresh_token, scopes, google_email")
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

  // Load the claim + related records.
  const { data: claim, error: claimError } = await supabaseAdmin
    .from("claims")
    .select(
      "id, claim_number, internal_claim_number, type_of_loss, cause_of_loss, date_of_loss, status, description, loss_location_address, loss_location_city, loss_location_state, loss_location_zip, policy_id, carrier_id, carrier_adjuster_id, contact_id",
    )
    .eq("id", body.claim_id)
    .single();
  if (claimError || !claim) return json({ error: "Claim not found" }, 404);

  const [carrier, adjuster, contact, policy] = await Promise.all([
    claim.carrier_id
      ? supabaseAdmin
          .from("carriers")
          .select("name")
          .eq("id", claim.carrier_id)
          .single()
      : Promise.resolve({ data: null }),
    claim.carrier_adjuster_id
      ? supabaseAdmin
          .from("carrier_adjusters")
          .select("first_name, last_name, email, phone, license_number")
          .eq("id", claim.carrier_adjuster_id)
          .single()
      : Promise.resolve({ data: null }),
    claim.contact_id
      ? supabaseAdmin
          .from("contacts")
          .select("first_name, last_name, email, phone_1_number")
          .eq("id", claim.contact_id)
          .single()
      : Promise.resolve({ data: null }),
    claim.policy_id
      ? supabaseAdmin
          .from("policies")
          .select(
            "policy_number, policy_type, summary, all_other_perils_deductible, hurricane_deductible_pct",
          )
          .eq("id", claim.policy_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const accessToken = await refreshAccessToken(connection.refresh_token);

  // Build the event payload.
  const carrierName = carrier.data?.name ?? "carrier";
  const claimRef =
    claim.claim_number || claim.internal_claim_number || `claim ${claim.id}`;
  const summary = `${KIND_LABEL[kind]} — ${carrierName} ${claimRef}`;

  const locationParts = [
    claim.loss_location_address,
    claim.loss_location_city,
    claim.loss_location_state,
    claim.loss_location_zip,
  ].filter(Boolean);
  const location =
    body.location_override?.trim() ||
    (locationParts.length > 0 ? locationParts.join(", ") : "");

  const description = buildDescription({
    kind,
    claim,
    carrier: carrier.data,
    adjuster: adjuster.data,
    contact: contact.data,
    policy: policy.data,
    additional_notes: body.additional_notes,
  });

  // Compose attendees: caller + insured + carrier adjuster + extras,
  // deduped. Each unique email gets one invite. We do NOT auto-invite
  // the carrier representative if their email is missing.
  const attendeeEmails = new Set<string>();
  if (sales.email) attendeeEmails.add(sales.email.toLowerCase());
  if (contact.data?.email) attendeeEmails.add(contact.data.email.toLowerCase());
  if (adjuster.data?.email)
    attendeeEmails.add(adjuster.data.email.toLowerCase());
  for (const e of body.attendees ?? []) {
    const trimmed = e.trim().toLowerCase();
    if (trimmed) attendeeEmails.add(trimmed);
  }

  const eventBody = {
    summary,
    location,
    description,
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
    attendees: [...attendeeEmails].map((email) => ({ email })),
    source: { title: "CARE AI CRM", url: "" },
    extendedProperties: {
      private: {
        care_ai_claim_id: String(claim.id),
        care_ai_kind: kind,
      },
    },
  };

  const createRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(eventBody),
    },
  );
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    return json(
      {
        error: `Calendar API ${createRes.status}`,
        detail: detail.slice(0, 500),
      },
      502,
    );
  }
  const event = (await createRes.json()) as GoogleEvent;

  // Persist.
  const { data: row, error: insertError } = await supabaseAdmin
    .from("calendar_events")
    .upsert(
      {
        sales_id: sales.id,
        google_event_id: event.id,
        google_calendar_id: "primary",
        ical_uid: event.iCalUID ?? null,
        html_link: event.htmlLink ?? null,
        summary: event.summary,
        description: event.description,
        location: event.location,
        starts_at: event.start?.dateTime ?? event.start?.date ?? null,
        ends_at: event.end?.dateTime ?? event.end?.date ?? null,
        all_day: !event.start?.dateTime,
        kind,
        claim_id: claim.id,
        contact_id: claim.contact_id ?? null,
        carrier_adjuster_id: claim.carrier_adjuster_id ?? null,
        status: "scheduled",
        source: "created",
        notes: body.additional_notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sales_id,google_event_id" },
    )
    .select()
    .single();
  if (insertError) {
    return json(
      {
        error: "Event created in Google but could not persist to CRM",
        detail: insertError.message,
        google_event_id: event.id,
        html_link: event.htmlLink,
      },
      207,
    );
  }

  return json({
    event_id: row?.id,
    google_event_id: event.id,
    html_link: event.htmlLink,
    summary: event.summary,
    starts_at: row?.starts_at,
    ends_at: row?.ends_at,
    attendees: [...attendeeEmails],
  });
});

// --- helpers ---

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

interface GoogleEvent {
  id: string;
  iCalUID?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface DescriptionInputs {
  kind: string;
  claim: {
    claim_number?: string | null;
    internal_claim_number?: string | null;
    type_of_loss?: string | null;
    cause_of_loss?: string | null;
    date_of_loss?: string | null;
    description?: string | null;
    status?: string | null;
  };
  carrier: { name?: string } | null;
  adjuster: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    license_number?: string;
  } | null;
  contact: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_1_number?: string;
  } | null;
  policy: {
    policy_number?: string;
    policy_type?: string;
    summary?: string;
    all_other_perils_deductible?: number;
    hurricane_deductible_pct?: number;
  } | null;
  additional_notes?: string;
}

function buildDescription(args: DescriptionInputs): string {
  const lines: string[] = [];
  lines.push(`Kind: ${KIND_LABEL[args.kind] ?? args.kind}`);
  if (args.claim.claim_number || args.claim.internal_claim_number) {
    lines.push(
      `Claim #: ${args.claim.claim_number ?? "—"}` +
        (args.claim.internal_claim_number
          ? ` (internal ${args.claim.internal_claim_number})`
          : ""),
    );
  }
  if (args.claim.date_of_loss) lines.push(`DOL: ${args.claim.date_of_loss}`);
  if (args.claim.type_of_loss || args.claim.cause_of_loss) {
    lines.push(
      `Loss: ${[args.claim.type_of_loss, args.claim.cause_of_loss]
        .filter(Boolean)
        .join(" / ")}`,
    );
  }
  if (args.claim.status) lines.push(`Status: ${args.claim.status}`);
  if (args.carrier?.name) lines.push(`Carrier: ${args.carrier.name}`);
  if (args.adjuster) {
    const name = [args.adjuster.first_name, args.adjuster.last_name]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `Carrier adjuster: ${name || "—"}${
        args.adjuster.license_number
          ? ` (lic ${args.adjuster.license_number})`
          : ""
      }`,
    );
    if (args.adjuster.email) lines.push(`  ${args.adjuster.email}`);
    if (args.adjuster.phone) lines.push(`  ${args.adjuster.phone}`);
  }
  if (args.contact) {
    const name = [args.contact.first_name, args.contact.last_name]
      .filter(Boolean)
      .join(" ");
    lines.push(`Insured: ${name || "—"}`);
    if (args.contact.email) lines.push(`  ${args.contact.email}`);
    if (args.contact.phone_1_number)
      lines.push(`  ${args.contact.phone_1_number}`);
  }
  if (args.policy) {
    lines.push(
      `Policy: ${args.policy.policy_type ?? "—"} ${args.policy.policy_number ?? ""}`.trim(),
    );
    if (
      args.policy.all_other_perils_deductible !== undefined &&
      args.policy.all_other_perils_deductible !== null
    ) {
      lines.push(
        `  AOP deductible: $${args.policy.all_other_perils_deductible}`,
      );
    }
    if (
      args.policy.hurricane_deductible_pct !== undefined &&
      args.policy.hurricane_deductible_pct !== null
    ) {
      lines.push(
        `  Hurricane deductible: ${args.policy.hurricane_deductible_pct}%`,
      );
    }
    if (args.policy.summary) {
      lines.push("");
      lines.push("Policy summary:");
      lines.push(args.policy.summary);
    }
  }
  if (args.claim.description) {
    lines.push("");
    lines.push("Claim description:");
    lines.push(args.claim.description);
  }
  if (args.additional_notes) {
    lines.push("");
    lines.push("Notes:");
    lines.push(args.additional_notes);
  }
  lines.push("");
  lines.push("— scheduled via CARE AI CRM");
  return lines.join("\n");
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
