import { useState, useRef, useEffect } from 'react';
import { ChatMessage as ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { streamChat, ChatMessage } from '../../api/chat';

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string) => {
    const userMessage: ChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      for await (const chunk of streamChat(updatedMessages)) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Error: ${msg}`,
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <>
      {/* Toggle button — gold circle, bottom right */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl"
        style={{ backgroundColor: '#C9A84C', color: '#162C52' }}
        aria-label="Toggle AI Chat"
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Slide-out panel */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-96 h-[500px] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ border: '1px solid rgba(201,168,76,0.3)' }}
        >
          {/* Header — dark navy with gold text */}
          <div
            className="px-4 py-3 flex-shrink-0"
            style={{ backgroundColor: '#162C52', borderBottom: '1px solid rgba(201,168,76,0.4)' }}
          >
            <h3 className="font-semibold text-sm" style={{ color: '#C9A84C' }}>
              CARE AI Assistant
            </h3>
            <p className="text-xs" style={{ color: 'rgba(201,168,76,0.65)' }}>
              Ask about contacts, deals, or claims
            </p>
          </div>

          {/* Messages — card background */}
          <div className="flex-1 overflow-y-auto p-4 bg-card">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm text-center mt-8">
                Ask me anything about your claims pipeline.
              </p>
            )}
            {messages.map((msg, i) => (
              <ChatMessageComponent key={i} role={msg.role} content={msg.content} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <ChatInput onSend={handleSend} disabled={isStreaming} />
        </div>
      )}
    </>
  );
}
