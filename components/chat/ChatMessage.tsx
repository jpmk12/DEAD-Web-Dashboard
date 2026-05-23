import { ChatMessage as ChatMessageType } from "@/lib/types";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-emerald-600/80 text-white rounded-br-sm"
            : "bg-slate-800/80 border border-slate-700/60 text-slate-100 rounded-bl-sm"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
