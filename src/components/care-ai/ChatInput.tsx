import { useState, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex gap-2 p-3 flex-shrink-0"
      style={{ backgroundColor: '#0A1628', borderTop: '1px solid rgba(201,168,76,0.2)' }}
    >
      <textarea
        className="flex-1 resize-none rounded-md px-3 py-2 text-sm focus:outline-none"
        style={{
          backgroundColor: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(201,168,76,0.25)',
          color: 'rgba(255,255,255,0.9)',
        }}
        rows={2}
        placeholder="Ask about your contacts, deals, or claims..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        className="px-4 py-2 text-sm rounded-md disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        style={{ backgroundColor: '#C9A84C', color: '#0A1628' }}
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </div>
  );
}
