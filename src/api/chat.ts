const SYSTEM_PROMPT = `You are an AI assistant for C.A.R.E. Claims, an insurance claims advocacy firm.
You help staff manage contacts, deals, and insurance claims workflows.
The claims pipeline stages are: New Lead → Claim Filed → Adjuster Assigned → Adjuster Meeting → Negotiation → Settlement → Closed Won / Closed Lost.
Be concise and direct. If asked about specific contact or deal data you don't have access to yet, say so clearly.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function* streamChat(messages: ChatMessage[]) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'CARE AI CRM',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-3',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));
    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed SSE chunks
      }
    }
  }
}
