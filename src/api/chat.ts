// Frontend client for the server-side CARE AI chat agent.
//
// The actual Anthropic API call, system prompt, and CRM SQL tool live in
// the `chat` Supabase edge function (supabase/functions/chat). This
// keeps the model API key off the browser and gives the agent real
// read access to the CRM database.

import { getSupabaseClient } from "../components/atomic-crm/providers/supabase/supabase";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatQueryLog {
  sql: string;
  rationale?: string;
  rows?: number;
  error?: string;
}

export interface ChatResponse {
  message: string;
  iterations: number;
  queries: ChatQueryLog[];
}

export async function sendChat(messages: ChatMessage[]): Promise<ChatResponse> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error("Not signed in.");
  }

  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Chat failed (${res.status}): ${detail || res.statusText}`);
  }

  const payload = (await res.json()) as Partial<ChatResponse> & {
    error?: string;
  };
  if (payload.error) {
    throw new Error(payload.error);
  }
  return {
    message: payload.message ?? "",
    iterations: payload.iterations ?? 0,
    queries: payload.queries ?? [],
  };
}
