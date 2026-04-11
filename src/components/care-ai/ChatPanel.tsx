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
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content:
            'Error: Could not reach the AI. Check your VITE_OPENROUTER_API_KEY in .env.local.',
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center text-2xl"
        aria-label="Toggle AI Chat"
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[500px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col">
          <div className="px-4 py-3 bg-blue-600 rounded-t-xl flex-shrink-0">
            <h3 className="text-white font-semibold text-sm">CARE AI Assistant</h3>
            <p className="text-blue-100 text-xs">Ask about contacts, deals, or claims</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-gray-400 text-sm text-center mt-8">
                Ask me anything about your claims pipeline.
              </p>
            )}
            {messages.map((msg, i) => (
              <ChatMessageComponent key={i} role={msg.role} content={msg.content} />
            ))}
            <div ref={bottomRef} />
          </div>
          <ChatInput onSend={handleSend} disabled={isStreaming} />
        </div>
      )}
    </>
  );
}
