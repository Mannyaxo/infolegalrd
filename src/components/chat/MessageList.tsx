"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useChat";
import { Message } from "./Message";

export function MessageList({
  messages,
  isTyping,
}: {
  messages: ChatMessage[];
  isTyping: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  return (
    <div className="chat-message-list">
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
      {isTyping && (
        <div className="chat-msg chat-msg-assistant animate-in" role="status" aria-live="polite">
          <div className="chat-msg-inner">
            <div className="dot-pulse">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
}
