// Draft an AI reply to a triaged Gmail thread.
//
// POST /functions/v1/draft-email-reply
// Body: { triage_id: number, instructions?: string, save_to_gmail?: boolean }
// Auth: caller JWT. The caller must own the triage row (sales_id =
// the caller's sales row).
//
// Process:
//   1. Resolve caller → sales row.
//   2. Load triage row (verify ownership) + linked Gmail connection.
//   3. Load the linked claim (if any) with policy summary + recent
//      estimates + recent settlements so the model writes a
//      context-grounded reply.
//   4. Refresh the Google access token, fetch the Gmail thread, take
//      its last 3 messages as conversation context.
//   5. Force Claude to call draft_reply with a structured response.
//   6. Optional save_to_gmail = true: build a MIME message and POST
//      to users.drafts.create with the gmail_thread_id so the draft
//      lands in-thread. Returns the Gmail draft id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_DRAFT_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const DRAFT_TOOL = {
  name: "draft_reply",
  description:
    "Save a draft reply for staff review. Never sends. Staff will edit and send from Gmail.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      body: {
        type: "string",
        description:
          "Plain text body. No HTML. Sign off as the staffer; the firm's signature will be appended downstream.",
      },
      tone: {
        type: "string",
        enum: [
          "informational",
          "supplement_request",
          "appraisal_invocation_prep",
          "escalation_warning",
          "decline_with_explanation",
        ],
      },
      references_facts: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific facts the draft relies on (policy provision, line item, statute concept, date). Lets the reviewer check them.",
      },
      confidence_notes: {
        type: "string",
        description:
          "What's uncertain. If the CRM data was thin, say so concretely.",
      },
    },
    required: [
      "subject",
      "body",
      "tone",
      "references_facts",
      "confidence_notes",
    ],
  },
} as const;

const SYSTEM = `You draft replies for staff at a public-adjusting firm.

Hard rules:
- You are NEVER the sender. A staffer reviews and sends. Write in the first person as the staffer.
- Decision support, not legal advice. Never quote statute numbers you weren't given. Never promise the carrier anything binding (settlement amount, time-bar concessions, withdrawal of demand).
- Cite specific facts from the loaded CRM data and the email thread. If the data is thin (e.g. no policy summary loaded, no estimate on file), say so in confidence_notes and write a SHORTER, more cautious draft.
- Tone matches the user's intent: informational (status, scheduling), supplement_request (we need them to revisit a line item), appraisal_invocation_prep (we are likely to invoke and want documentation aligned), escalation_warning (delays / undervaluation / missed deadlines), decline_with_explanation (e.g. their proposed scope is incomplete and here is why).
- Default sign-off: leave a single placeholder line "[Your signature]" so staff can drop in the firm's footer.
- Plain text only. No markdown headings. Short paragraphs. Numbered lists where they help the carrier process the message.
- Do NOT advise the insured directly in the draft. Audience is the carrier representative or their counsel.

You MUST call draft_reply exactly once.`;

interface Body {
  triage_id: number;
  instructions?: string;
  save_to_gmail?: boolean;
  // When save_to_gmail is true, the UI may pass the staffer-edited
  // subject and body to save instead of the AI's raw output. We
  // accept and forward; the AI is only consulted again to fill in
  // tone / references_facts metadata for the response payload.
  draft_override?: { subject?: string; body?: string };
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

  let body: Body;
  try {
    body = (await req.json()) ?? ({} as Body);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body?.triage_id || typeof body.triage_id !== "number") {
    return json({ error: "triage_id (number) is required" }, 400);
  }

  // Caller → sales
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

  // Load the triage row (admin client; we authorize manually).
  const { data: triage, error: triageError } = await supabaseAdmin
    .from("email_triage")
    .select(
      "id, sales_id, gmail_thread_id, latest_message_id, subject, from_email, from_name, body_excerpt, claim_id, carrier_id, classification, urgency, summary",
    )
    .eq("id", body.triage_id)
    .single();
  if (triageError || !triage) {
    return json({ error: "Triage row not found" }, 404);
  }
  if (triage.sales_id !== sales.id) {
    return json({ error: "You don't own this triage row" }, 403);
  }

  // Load the Gmail connection (need refresh token).
  const { data: connection } = await supabaseAdmin
    .from("gmail_connections")
    .select("id, google_email, refresh_token, scopes")
    .eq("sales_id", sales.id)
    .single();
  if (!connection) {
    return json(
      { error: "Gmail is not connected. Connect it on /email-triage first." },
      400,
    );
  }
  if (
    body.save_to_gmail &&
    !connection.scopes?.some(
      (s: string) => s === "https://www.googleapis.com/auth/gmail.modify",
    )
  ) {
    return json(
      {
        error:
          "Gmail connection lacks gmail.modify scope. Reconnect with the upgraded scope to save drafts to Gmail.",
      },
      400,
    );
  }

  // Load claim context if available.
  let claimContext: Record<string, unknown> | null = null;
  if (triage.claim_id) {
    const [claimRes, policyRes, estimatesRes, settlementRes] =
      await Promise.all([
        supabaseAdmin
          .from("claims")
          .select(
            "id, claim_number, internal_claim_number, date_of_loss, type_of_loss, cause_of_loss, loss_location_state, status, description, policy_id, carrier_id",
          )
          .eq("id", triage.claim_id)
          .single(),
        supabaseAdmin
          .from("policies")
          .select(
            "id, policy_type, state_abbr, coverage_a_dwelling, all_other_perils_deductible, hurricane_deductible_pct, summary",
          )
          .eq(
            "id",
            (
              await supabaseAdmin
                .from("claims")
                .select("policy_id")
                .eq("id", triage.claim_id)
                .single()
            ).data?.policy_id ?? -1,
          )
          .single(),
        supabaseAdmin
          .from("estimates")
          .select(
            "id, source, source_name, rcv_total, acv_total, deductible_applied, net_payable, summary",
          )
          .eq("claim_id", triage.claim_id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabaseAdmin
          .from("settlements")
          .select("id, method, settlement_amount, settled_at, our_role")
          .eq("claim_id", triage.claim_id)
          .maybeSingle(),
      ]);
    claimContext = {
      claim: claimRes.data,
      policy: policyRes.data,
      estimates: estimatesRes.data,
      settlement: settlementRes.data,
    };
  }

  // Refresh access token + pull recent thread messages for context.
  const accessToken = await refreshAccessToken(connection.refresh_token);
  const threadContext = await fetchRecentThreadMessages(
    accessToken,
    triage.gmail_thread_id,
  );

  // Call Anthropic.
  const inputs = {
    staffer: {
      name: [sales.first_name, sales.last_name].filter(Boolean).join(" "),
      email: sales.email,
    },
    triage_row: {
      subject: triage.subject,
      from_name: triage.from_name,
      from_email: triage.from_email,
      classification: triage.classification,
      urgency: triage.urgency,
      ai_summary: triage.summary,
      body_excerpt: triage.body_excerpt,
    },
    claim_context: claimContext,
    recent_thread_messages: threadContext,
    staffer_instructions: body.instructions ?? null,
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
      max_tokens: 2048,
      system: SYSTEM,
      tool_choice: { type: "tool", name: DRAFT_TOOL.name },
      tools: [DRAFT_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Draft a reply. Inputs:\n\n```json\n" +
                JSON.stringify(inputs, null, 2) +
                "\n```\n\nCall draft_reply.",
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
      b.type === "tool_use" && b.name === DRAFT_TOOL.name,
  );
  if (!toolUse) {
    return json({ error: "Model did not return a tool_use block" }, 502);
  }

  const draft = toolUse.input as {
    subject: string;
    body: string;
    tone: string;
    references_facts: string[];
    confidence_notes: string;
  };

  // Optionally save to Gmail drafts.
  let gmailDraftId: string | null = null;
  let gmailSaveError: string | null = null;
  if (body.save_to_gmail) {
    try {
      const replyTo = triage.from_email;
      if (!replyTo)
        throw new Error("Triage row has no from_email to reply to.");
      const overrideSubject = body.draft_override?.subject?.trim();
      const overrideBody = body.draft_override?.body;
      const rawSubject =
        overrideSubject && overrideSubject.length > 0
          ? overrideSubject
          : draft.subject;
      const finalBody =
        typeof overrideBody === "string" && overrideBody.length > 0
          ? overrideBody
          : draft.body;
      const subject = rawSubject.toLowerCase().startsWith("re:")
        ? rawSubject
        : `Re: ${rawSubject}`;
      const mime = buildMime({
        to: replyTo,
        from: sales.email ?? connection.google_email,
        subject,
        body: finalBody,
      });
      const raw = base64UrlEncode(mime);
      const createRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: { raw, threadId: triage.gmail_thread_id },
          }),
        },
      );
      if (!createRes.ok) {
        const txt = await createRes.text().catch(() => "");
        throw new Error(
          `Gmail drafts.create ${createRes.status}: ${txt.slice(0, 200)}`,
        );
      }
      const created = (await createRes.json()) as { id?: string };
      gmailDraftId = created.id ?? null;
    } catch (err) {
      gmailSaveError = err instanceof Error ? err.message : String(err);
    }
  }

  return json({
    triage_id: triage.id,
    draft,
    saved_to_gmail: gmailDraftId !== null,
    gmail_draft_id: gmailDraftId,
    gmail_save_error: gmailSaveError,
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

interface ThreadMessageSnippet {
  from: string | null;
  to: string | null;
  date: string | null;
  body: string | null;
}

async function fetchRecentThreadMessages(
  accessToken: string,
  threadId: string,
): Promise<ThreadMessageSnippet[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    messages?: Array<{
      payload?: {
        mimeType?: string;
        headers?: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{
          mimeType?: string;
          body?: { data?: string };
          parts?: unknown[];
        }>;
      };
    }>;
  };
  const messages = data.messages ?? [];
  return messages.slice(-3).map((m) => {
    const headers = new Map(
      (m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
    );
    return {
      from: headers.get("from") ?? null,
      to: headers.get("to") ?? null,
      date: headers.get("date") ?? null,
      body: extractTextBody(m.payload)?.slice(0, 4_000) ?? null,
    };
  });
}

interface PayloadShape {
  mimeType?: string;
  body?: { data?: string };
  parts?: PayloadShape[];
}
function extractTextBody(payload?: PayloadShape): string | null {
  if (!payload) return null;
  if (payload.body?.data && payload.mimeType?.startsWith("text/")) {
    return decodeBase64Url(payload.body.data);
  }
  for (const p of payload.parts ?? []) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return decodeBase64Url(p.body.data);
    }
  }
  for (const p of payload.parts ?? []) {
    const n = extractTextBody(p);
    if (n) return n;
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

function buildMime(args: {
  to: string;
  from: string;
  subject: string;
  body: string;
}): string {
  // Minimal RFC 822 message. Gmail handles threading by threadId; we
  // don't need Message-Id / In-Reply-To headers for the draft to
  // attach to the right thread.
  const lines = [
    `To: ${args.to}`,
    `From: ${args.from}`,
    `Subject: ${encodeMimeHeader(args.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    args.body,
  ];
  return lines.join("\r\n");
}

function encodeMimeHeader(s: string): string {
  // RFC 2047 encoded-word for any non-ASCII chars.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
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
