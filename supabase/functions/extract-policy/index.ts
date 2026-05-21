// extract-policy (Roadmap Stage 4 - Policy Review agent)
// Downloads an uploaded policy PDF from storage, extracts its text, and stores
// it on the policy record so the Policy Review agent can read the wording.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware } from "../_shared/authentication.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { extractText, getDocumentProxy } from "npm:unpdf";

const BUCKET = Deno.env.get("ATTACHMENTS_BUCKET") ?? "attachments";
const MAX_TEXT = 200_000; // cap stored text so it fits an agent tool result

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  let policyId: number;
  try {
    policyId = Number((await req.json())?.policyId);
  } catch {
    return createErrorResponse(400, "Request body must be valid JSON");
  }
  if (!Number.isInteger(policyId) || policyId <= 0) {
    return createErrorResponse(400, "A valid numeric 'policyId' is required");
  }

  const { data: policy, error: policyError } = await supabaseAdmin
    .from("policies")
    .select("id, document_path")
    .eq("id", policyId)
    .single();
  if (policyError || !policy) {
    return createErrorResponse(404, `Policy ${policyId} not found`);
  }
  if (!policy.document_path) {
    return createErrorResponse(400, "This policy has no uploaded document");
  }

  const { data: file, error: downloadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(policy.document_path);
  if (downloadError || !file) {
    console.error("policy download failed:", downloadError);
    return createErrorResponse(502, "Could not download the policy file");
  }

  let text = "";
  let pages = 0;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const result = await extractText(pdf, { mergePages: true });
    pages = result.totalPages ?? 0;
    text = (
      Array.isArray(result.text)
        ? result.text.join("\n\n")
        : (result.text ?? "")
    ).trim();
  } catch (e) {
    console.error("PDF extraction failed:", e);
    return createErrorResponse(
      422,
      "Could not extract text from this PDF. It may be a scanned image with no selectable text.",
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("policies")
    .update({ document_text: text.slice(0, MAX_TEXT) })
    .eq("id", policyId);
  if (updateError) {
    console.error("could not save extracted text:", updateError);
    return createErrorResponse(500, "Could not save the extracted text");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      policyId,
      pages,
      characters: Math.min(text.length, MAX_TEXT),
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, async (req) => {
      try {
        return await handle(req);
      } catch (e) {
        console.error("extract-policy error:", e);
        return createErrorResponse(500, "Internal Server Error");
      }
    }),
  ),
);
