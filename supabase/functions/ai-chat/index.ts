// ai-chat — secure server-side proxy to the Anthropic Claude API.
//
// Why this exists (Roadmap Stage 1):
// The browser must NEVER hold the Anthropic API key. This Edge Function keeps
// the key on the server, requires the caller to be a logged-in user, calls
// Claude, and streams the answer back as plain text.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware } from "../_shared/authentication.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the AI assistant for C.A.R.E. (Claims Advocate Resolution Experts), a public adjusting firm that represents policyholders — not insurance carriers — in property insurance claims.
You help firm staff manage contacts, claims, policies, and day-to-day claim workflows.
The claims pipeline stages are: New Lead -> Claim Filed -> Adjuster Assigned -> Adjuster Meeting -> Negotiation -> Settlement -> Closed Won / Closed Lost.
Be concise, direct, and practical. You provide decision support, not legal advice; remind staff that a licensed professional must review anything sent to a client or carrier.
If asked about specific claim or policy data you have not been given, say so plainly instead of guessing.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function handleChat(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return createErrorResponse(405, "Method Not Allowed");
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set");
    return createErrorResponse(500, "AI assistant is not configured");
  }

  let messages: unknown;
  try {
    messages = (await req.json())?.messages;
  } catch {
    return createErrorResponse(400, "Request body must be valid JSON");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return createErrorResponse(
      400,
      "Body must include a non-empty 'messages' array",
    );
  }

  const safeMessages: ChatMessage[] = messages
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (safeMessages.length === 0) {
    return createErrorResponse(400, "No valid messages provided");
  }

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: safeMessages,
        stream: true,
      }),
    });
  } catch (err) {
    console.error("Failed to reach Anthropic:", err);
    return createErrorResponse(502, "Could not reach the AI provider");
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("Anthropic error", upstream.status, detail);
    return createErrorResponse(502, `AI provider error (${upstream.status})`);
  }

  // Translate Anthropic's Server-Sent Events into a plain UTF-8 text stream.
  // The browser then only has to read text — it never parses provider formats.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            typeof event.delta.text === "string"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) => handleChat(req)),
  ),
);
