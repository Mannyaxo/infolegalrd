"use client";

export function TypingIndicator() {
  return (
    <div className="chat-msg chat-msg-assistant animate-in" role="status" aria-live="polite">
      <div className="chat-msg-inner">
        <div className="dot-pulse">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
