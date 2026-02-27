"use client";

import type { ChatMessage } from "@/hooks/useChat";
import { LegalResponse } from "./LegalResponse";

export function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={
        isUser ? "chat-msg chat-msg-user animate-in" : "chat-msg chat-msg-assistant animate-in"
      }
      data-role={message.role}
    >
      <div className="chat-msg-inner">
        {isUser ? (
          <p className="chat-msg-text">{message.content}</p>
        ) : message.responseType === "clarify" && message.questions?.length ? (
          <div className="legal-response">
            <div className="legal-response-heading font-title">
              Para darte una mejor respuesta:
            </div>
            <ul className="legal-response-list">
              {message.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        ) : (
          <LegalResponse content={message.content} />
        )}
      </div>
    </div>
  );
}
