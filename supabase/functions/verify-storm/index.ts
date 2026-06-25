// Storm verification via HailTrace (or any address+date weather API).
//
// POST /functions/v1/verify-storm
// Body: { claim_id: number, lookback_days?: number, lookahead_days?: number }
// Auth: caller JWT.
//
// Configurable so the firm can swap in their actual HailTrace endpoint
// once they have API credentials (HailTrace gates the API behind a
// support email — see the deployment guide). Until those env vars are
// set, this function returns a clear "not configured" message and
// the UI falls back to manual entry.
//
// Required Supabase secrets when wired live:
//   HAILTRACE_API_KEY        — API key from HailTrace's developer team
//   HAILTRACE_API_BASE       — base URL, e.g. https://fa7c838b-developers.hailtrace.com/api/external
//   HAILTRACE_VERIFY_PATH    — endpoint path, e.g. /v1/hail_history
//                              (exact path: confirm with developers@hailtrace.com)
//   HAILTRACE_AUTH_HEADER    — header name carrying the key
//                              (default: "x-api-key")
//
// Response shape parsed defensively — HailTrace's response is not
// publicly documented, so we map a handful of common field names and
// store the raw body in raw_response for audit.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const HT_API_KEY = Deno.env.get("HAILTRACE_API_KEY") ?? "";
const HT_API_BASE = Deno.env.get("HAILTRACE_API_BASE") ?? "";
const HT_VERIFY_PATH = Deno.env.get("HAILTRACE_VERIFY_PATH") ?? "";
const HT_AUTH_HEADER = Deno.env.get("HAILTRACE_AUTH_HEADER") || "x-api-key";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

interface Body {
  claim_id: number;
  lookback_days?: number; // search window before DOL (default 3)
  lookahead_days?: number; // search window after DOL (default 3)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
  if (!body?.claim_id) return json({ error: "claim_id required" }, 400);

  if (!HT_API_KEY || !HT_API_BASE || !HT_VERIFY_PATH) {
    return json(
      {
        error:
          "HailTrace is not configured on this Supabase project. Set HAILTRACE_API_KEY, HAILTRACE_API_BASE, and HAILTRACE_VERIFY_PATH secrets (and email developers@hailtrace.com to obtain API access).",
        configured: false,
      },
      503,
    );
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
  const salesId = sales?.id ?? null;

  // Load the claim.
  const { data: claim, error: claimError } = await supabaseAdmin
    .from("claims")
    .select(
      "id, date_of_loss, loss_location_address, loss_location_city, loss_location_state, loss_location_zip",
    )
    .eq("id", body.claim_id)
    .single();
  if (claimError || !claim) return json({ error: "Claim not found" }, 404);
  if (!claim.date_of_loss)
    return json({ error: "Claim has no date_of_loss; set it first." }, 400);
  if (!claim.loss_location_address && !claim.loss_location_zip)
    return json(
      { error: "Claim has no loss_location_address or zip; set one first." },
      400,
    );

  const fullAddress = [
    claim.loss_location_address,
    claim.loss_location_city,
    claim.loss_location_state,
    claim.loss_location_zip,
  ]
    .filter(Boolean)
    .join(", ");

  const lookback = body.lookback_days ?? 3;
  const lookahead = body.lookahead_days ?? 3;
  const dol = new Date(claim.date_of_loss);
  const start = new Date(dol.getTime() - lookback * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const end = new Date(dol.getTime() + lookahead * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // HailTrace endpoint shape isn't publicly documented. We send a
  // permissive payload covering the field names commonly used in
  // weather-verification APIs. The actual endpoint your firm gets
  // from developers@hailtrace.com may want a subset of these or a
  // different envelope — adjust HT_VERIFY_PATH / this payload if so.
  const payload = {
    address: fullAddress,
    start_date: start,
    end_date: end,
    perils: ["hail", "wind"],
  };

  const url = `${HT_API_BASE.replace(/\/$/, "")}${HT_VERIFY_PATH.startsWith("/") ? "" : "/"}${HT_VERIFY_PATH}`;
  const apiRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [HT_AUTH_HEADER]: HT_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const rawText = await apiRes.text();
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    raw = { raw_text: rawText.slice(0, 4_000) };
  }

  if (!apiRes.ok) {
    return json(
      {
        error: `HailTrace ${apiRes.status}`,
        configured: true,
        endpoint: url,
        detail:
          typeof raw === "object" ? raw : { detail: String(raw).slice(0, 500) },
      },
      502,
    );
  }

  // Map the response defensively. We look for several common field
  // names; whichever exists wins.
  const events = extractEvents(raw);
  const inserts = events.map((ev) => ({
    claim_id: claim.id,
    sales_id: salesId,
    source: "hailtrace",
    event_date: ev.event_date,
    event_type: ev.event_type,
    hail_size_inches: ev.hail_size_inches,
    wind_speed_mph: ev.wind_speed_mph,
    wind_gust_mph: ev.wind_gust_mph,
    distance_miles: ev.distance_miles,
    confidence: ev.confidence,
    report_url: ev.report_url,
    raw_response: ev.raw,
    matches_loss_date:
      ev.event_date === claim.date_of_loss ||
      (ev.event_date !== null &&
        Math.abs(new Date(ev.event_date).getTime() - dol.getTime()) <=
          86_400_000),
    matches_loss_location: ev.distance_miles !== null && ev.distance_miles <= 1,
    notes: null,
  }));

  let savedCount = 0;
  if (inserts.length > 0) {
    const { error: upsertError, count } = await supabaseAdmin
      .from("claim_storm_verifications")
      .upsert(inserts, {
        onConflict: "claim_id,source,event_date",
        count: "exact",
      });
    if (upsertError) {
      return json(
        {
          error: "Verified at HailTrace but could not save to CRM",
          detail: upsertError.message,
          raw,
        },
        207,
      );
    }
    savedCount = count ?? inserts.length;
  }

  return json({
    claim_id: claim.id,
    address: fullAddress,
    window: { start, end },
    events_found: events.length,
    saved_count: savedCount,
    raw,
  });
});

// --- helpers ---

interface ParsedEvent {
  event_date: string | null;
  event_type: string | null;
  hail_size_inches: number | null;
  wind_speed_mph: number | null;
  wind_gust_mph: number | null;
  distance_miles: number | null;
  confidence: string | null;
  report_url: string | null;
  raw: unknown;
}

function extractEvents(payload: unknown): ParsedEvent[] {
  // Try several common shapes. If none match, return one event with
  // all fields null and the whole payload as raw — the UI can still
  // surface "we got a response but couldn't parse fields".
  const candidates: unknown[] = [];
  const p = payload as Record<string, unknown> | null;
  if (Array.isArray(payload)) candidates.push(...payload);
  else if (p) {
    for (const key of [
      "events",
      "results",
      "data",
      "hail_events",
      "wind_events",
    ]) {
      const v = p[key];
      if (Array.isArray(v)) candidates.push(...v);
    }
    if (candidates.length === 0) candidates.push(payload);
  }
  if (candidates.length === 0) return [];
  return candidates.map((c) => normalizeEvent(c));
}

function normalizeEvent(c: unknown): ParsedEvent {
  const o = (c ?? {}) as Record<string, unknown>;
  return {
    event_date: pickDate(o, [
      "event_date",
      "date",
      "occurred_at",
      "start_date",
    ]),
    event_type: pickString(o, ["event_type", "peril", "type", "kind"]),
    hail_size_inches: pickNumber(o, [
      "hail_size_inches",
      "hail_size",
      "max_hail_size_in",
      "hail_size_in",
    ]),
    wind_speed_mph: pickNumber(o, [
      "wind_speed_mph",
      "wind_speed",
      "max_wind_mph",
    ]),
    wind_gust_mph: pickNumber(o, ["wind_gust_mph", "gust_mph", "gust"]),
    distance_miles: pickNumber(o, [
      "distance_miles",
      "distance_mi",
      "miles_from_address",
    ]),
    confidence: pickString(o, ["confidence", "quality", "verified"]),
    report_url: pickString(o, ["report_url", "pdf_url", "link"]),
    raw: c,
  };
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function pickDate(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
