// Batch AI classification of Dropbox files.
//
// POST /functions/v1/classify-dropbox-files
// Body: { claim_id?: number, files: Array<{id, name, path}>, hints?: object }
// Auth: caller JWT.
//
// The Phase 11 dropbox-list function tags files by extension +
// filename heuristics (sees "policy" / "xact" / "denial" in the name).
// That covers maybe 70% of real-world filenames. For the rest —
// "Document.pdf", "scan-2025-04-12-001.pdf", "IMG_4823.JPG" — staff
// have to open files to figure out what they are. This function takes
// the same list dropbox-list returned and asks Claude to do a smarter
// pass using filename, path context (which subfolder it's in), and
// — when claim_id is provided — the claim's loss type and DOL so
// "Storm damage 4-12-25.pdf" near a hail claim with DOL April 12
// becomes a confident "report".
//
// No content is fetched from Dropbox. Names + paths only. Cheap, fast,
// and zero Dropbox API quota beyond what dropbox-list already used.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_DROPBOX_MODEL") ??
  Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const FILE_KINDS = [
  "policy",
  "estimate",
  "report",
  "correspondence",
  "contract",
  "photo",
  "video",
  "spreadsheet",
  "document",
  "email",
  "other",
] as const;

const CLASSIFY_TOOL = {
  name: "classify_files",
  description:
    "Tag each file in the batch with the most likely public-adjusting file kind.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: FILE_KINDS as unknown as string[] },
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["id", "kind", "confidence", "rationale"],
        },
      },
    },
    required: ["files"],
  },
} as const;

const SYSTEM = `You classify files in a public-adjusting firm's claim folder.

Possible kinds:
- policy        : insurance policy, declaration page, HO/DP/HP form
- estimate      : Xactimate, Symbility, CoreLogic, contractor estimate, scope of loss
- report        : meteorologist report, engineer report, moisture/inspection report, drone roof, HailTrace PDF, NOAA archive
- correspondence: denial letter, approval letter, demand letter, supplement request, email export
- contract      : letter of assignment, AOB, retainer, public-adjuster contract
- photo         : loss photos (jpg/png/heic/tif)
- video         : video walkthroughs
- spreadsheet   : xls/csv tracking sheet
- document      : Word doc, plain text — when nothing more specific fits
- email         : .eml or .msg archive
- other         : truly ambiguous

Cues:
- Filename tokens are the primary signal (policy, xact, engineer, denial, IMG_, DSC, scope, dec, HO3, AOB).
- Subfolder names matter: a file under /Photos/ is almost certainly a photo even if its name is random.
- Dates in filenames near the claim's DOL are a strong report/photo signal.
- Extensions: .pdf could be anything; image extensions are photos; .xlsx is spreadsheet; .docx is document unless name says otherwise.
- IMG_, DSC_, JPG_ → photo even with generic extension.
- If genuinely uncertain, return "other" with low confidence — do NOT guess.

You MUST call classify_files exactly once with one entry per input file, preserving the input ids.`;

interface InputFile {
  id: string;
  name: string;
  path: string;
}

interface Body {
  claim_id?: number;
  files: InputFile[];
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body?.files) || body.files.length === 0)
    return json({ error: "files[] is required" }, 400);
  if (body.files.length > 200)
    return json({ error: "Max 200 files per call" }, 400);

  // Auth — same pattern as the other JWT-authed functions.
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult } = await userClient.auth.getUser();
  if (!userResult?.user) return json({ error: "Invalid auth token" }, 401);

  // Optional claim context for smarter classification.
  let claimContext: Record<string, unknown> | null = null;
  if (body.claim_id) {
    const { data } = await supabaseAdmin
      .from("claims")
      .select(
        "id, claim_number, internal_claim_number, date_of_loss, type_of_loss, cause_of_loss, loss_location_state",
      )
      .eq("id", body.claim_id)
      .single();
    claimContext = data ?? null;
  }

  const inputs = {
    claim_context: claimContext,
    files: body.files.map((f) => ({
      id: f.id,
      name: f.name,
      path: f.path,
    })),
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
      tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
      tools: [CLASSIFY_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Inputs:\n\n```json\n" +
                JSON.stringify(inputs) +
                "\n```\n\nCall classify_files.",
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
      b.type === "tool_use" && b.name === CLASSIFY_TOOL.name,
  );
  if (!toolUse) {
    return json({ error: "Model did not return a tool_use block" }, 502);
  }

  return json({
    claim_id: body.claim_id ?? null,
    classified: (toolUse.input?.files ?? []).length,
    classifications: toolUse.input?.files ?? [],
    model: ANTHROPIC_MODEL,
    usage: reply.usage,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
