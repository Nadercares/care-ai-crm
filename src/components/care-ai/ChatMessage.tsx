interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className="max-w-[80%] rounded-lg px-4 py-2 text-sm"
        style={
          isUser
            ? { backgroundColor: '#C9A84C', color: '#162C52', fontWeight: 500 }
            : { backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.88)' }
        }
      >
        {content}
      </div>
    </div>
  );
}
