// Minimal Anthropic Claude client for the agent engine (Roadmap Stage 2).
// Supports tool use and prompt caching of the (large, reused) system prompt.

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ContentBlock = TextBlock | ToolUseBlock;

export interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Calls the Anthropic Messages API once.
 * The system prompt is sent as a cacheable block so multi-step agent loops
 * (which resend the same system prompt every turn) only pay for it once.
 */
export async function callClaude(opts: {
  model: string;
  system: string;
  messages: unknown[];
  tools?: ToolSchema[];
  maxTokens?: number;
}): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: [
        {
          type: "text",
          text: opts.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: opts.messages,
      ...(opts.tools && opts.tools.length ? { tools: opts.tools } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail}`);
  }

  return (await res.json()) as ClaudeResponse;
}
