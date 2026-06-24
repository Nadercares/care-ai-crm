import { useState, useRef, useEffect } from "react";
import { ChatMessage as ChatMessageComponent } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { sendChat, ChatMessage, ChatQueryLog } from "../../api/chat";

interface AssistantTurn {
  queries?: ChatQueryLog[];
  iterations?: number;
}

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turnMeta, setTurnMeta] = useState<Record<number, AssistantTurn>>({});
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSend = async (text: string) => {
    const userMessage: ChatMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsThinking(true);

    try {
      const reply = await sendChat(updatedMessages);
      setMessages((prev) => {
        const next = [
          ...prev,
          { role: "assistant" as const, content: reply.message },
        ];
        setTurnMeta((meta) => ({
          ...meta,
          [next.length - 1]: {
            queries: reply.queries,
            iterations: reply.iterations,
          },
        }));
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <>
      {/* Toggle button — gold circle, bottom right */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl"
        style={{ backgroundColor: "#C9A84C", color: "#162C52" }}
        aria-label="Toggle AI Chat"
      >
        {isOpen ? "✕" : "💬"}
      </button>

      {/* Slide-out panel */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-96 h-[560px] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ border: "1px solid rgba(201,168,76,0.3)" }}
        >
          {/* Header — dark navy with gold text */}
          <div
            className="px-4 py-3 flex-shrink-0"
            style={{
              backgroundColor: "#162C52",
              borderBottom: "1px solid rgba(201,168,76,0.4)",
            }}
          >
            <h3 className="font-semibold text-sm" style={{ color: "#C9A84C" }}>
              CARE AI Assistant
            </h3>
            <p className="text-xs" style={{ color: "rgba(201,168,76,0.65)" }}>
              Reads your claims, policies, carriers, contacts in real time
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-card space-y-1">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-8">
                Ask me about a claim, a carrier, an estimate, or a policy.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i}>
                <ChatMessageComponent role={msg.role} content={msg.content} />
                {msg.role === "assistant" && turnMeta[i]?.queries?.length ? (
                  <QueryAudit queries={turnMeta[i].queries!} />
                ) : null}
              </div>
            ))}
            {isThinking && (
              <div className="text-xs text-muted-foreground italic px-2 py-1">
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <ChatInput onSend={handleSend} disabled={isThinking} />
        </div>
      )}
    </>
  );
}

function QueryAudit({ queries }: { queries: ChatQueryLog[] }) {
  return (
    <details className="ml-3 mt-1 mb-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {queries.length} CRM quer{queries.length === 1 ? "y" : "ies"} run
      </summary>
      <ul className="mt-1 space-y-1 list-disc list-inside">
        {queries.map((q, i) => (
          <li key={i}>
            {q.rationale && <span>{q.rationale} — </span>}
            <span>
              {q.error
                ? `error: ${q.error}`
                : `${q.rows ?? 0} row${q.rows === 1 ? "" : "s"}`}
            </span>
            <pre className="mt-1 ml-3 whitespace-pre-wrap break-all opacity-70">
              {q.sql}
            </pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
