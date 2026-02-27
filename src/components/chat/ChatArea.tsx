"use client";

import type { ChatMessage } from "@/hooks/useChat";
import { WelcomeState } from "./WelcomeState";
import { MessageList } from "./MessageList";

type ChatAreaProps = {
  messages: ChatMessage[];
  isTyping: boolean;
  onSuggestion: (text: string) => void;
};

export function ChatArea({ messages, isTyping, onSuggestion }: ChatAreaProps) {
  const hasMessages = messages.length > 0;

  return (
    <div className="chat-area">
      {!hasMessages ? (
        <WelcomeState onSuggestion={onSuggestion} />
      ) : (
        <MessageList messages={messages} isTyping={isTyping} />
      )}
    </div>
  );
}
