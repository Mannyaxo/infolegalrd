"use client";

const SUGGESTIONS = [
  "Ley sobre preaviso laboral en República Dominicana",
  "Mis derechos ante un despido injustificado",
  "Proceso para divorcio de mutuo acuerdo",
  "Requisitos para constituir una SRL en RD",
];

type WelcomeStateProps = {
  onSuggestion: (text: string) => void;
};

export function WelcomeState({ onSuggestion }: WelcomeStateProps) {
  return (
    <div className="chat-welcome animate-in">
      <div className="chat-welcome-icon" aria-hidden>
        ⚖️
      </div>
      <h2 className="chat-welcome-title font-title">¿En qué te puedo ayudar?</h2>
      <div className="chat-welcome-grid">
        {SUGGESTIONS.map((text, i) => (
          <button
            key={i}
            type="button"
            className="chat-welcome-card"
            onClick={() => onSuggestion(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
