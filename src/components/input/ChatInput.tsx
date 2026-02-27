"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";

const MIN_ROWS = 1;
const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 24;
const MAX_HEIGHT_PX = MAX_ROWS * LINE_HEIGHT_PX;

const HINTS = ["Ley sobre…", "Mis derechos…", "Proceso para…"];

const DISCLAIMER =
  "Orientación informativa únicamente. No constituye asesoría legal ni relación abogado-cliente. Consulta a un abogado colegiado para tu caso.";

type ChatInputProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Escribe tu consulta legal…",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, MIN_ROWS * LINE_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${h}px`;
  };

  const fillHint = (prefix: string) => {
    setValue((prev) => (prev ? `${prev} ${prefix}` : prefix));
    textareaRef.current?.focus();
  };

  return (
    <div className="chat-input-wrap">
      <div className="chat-input-hints">
        {HINTS.map((label, i) => (
          <button
            key={i}
            type="button"
            className="chat-input-hint"
            onClick={() => fillHint(label)}
            aria-label={`Sugerencia: ${label}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          rows={MIN_ROWS}
          disabled={disabled}
          aria-label="Mensaje"
        />
        <button
          type="button"
          className="chat-input-send btn-send"
          onClick={send}
          disabled={!value.trim() || disabled}
          aria-label="Enviar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>
      <p className="chat-input-disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
