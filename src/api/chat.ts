import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Streams an AI reply for the given conversation.
 *
 * The browser does NOT call the AI provider directly anymore (that exposed the
 * API key). It calls the `ai-chat` Supabase Edge Function, which holds the key
 * server-side, verifies the user is logged in, and streams back plain text.
 */
export async function* streamChat(messages: ChatMessage[]) {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in to use the AI assistant.");
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    },
  );

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body?.message) detail = body.message;
    } catch {
      // keep statusText
    }
    throw new Error(`AI assistant error (${response.status}): ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
}
