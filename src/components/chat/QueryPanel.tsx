"use client";

import { useState, useRef, useEffect } from "react";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";

type QueryPanelProps = { suggestedQuery?: string | null; onSuggestionApplied?: () => void };

type ApiResponse =
  | { type: "answer"; content: string; note?: string }
  | { type: "clarify"; questions: string[] }
  | { type: "reject"; message: string };

const EXAMPLES = [
  "¿Qué es la renuncia voluntaria y qué efectos tiene en RD?",
  "¿Requisitos para divorcio de mutuo acuerdo en RD?",
  "¿Qué dice la ley sobre el preaviso en RD?",
];

export function QueryPanel({ suggestedQuery, onSuggestionApplied }: QueryPanelProps = {}) {
  const [input, setInput] = useState("");
  const [maxReliability, setMaxReliability] = useState(false);
  useEffect(() => {
    if (suggestedQuery) {
      setInput(suggestedQuery);
      onSuggestionApplied?.();
    }
  }, [suggestedQuery, onSuggestionApplied]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<"idle" | "answer" | "clarify" | "reject">("idle");
  const [content, setContent] = useState("");
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
  const [rejectMessage, setRejectMessage] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const supabase = useSupabase();
  const { user } = useAuth(supabase);

  const setMode = (isMax: boolean) => {
    setMaxReliability(isMax);
  };

  const fillExample = (text: string) => {
    setInput(text);
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setResponse("idle");
    setContent("");
    setClarifyQuestions([]);
    setRejectMessage("");
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: [],
          userId: user?.id ?? null,
          mode: maxReliability ? "max-reliability" : "standard",
        }),
      });
      const data = (await res.json()) as ApiResponse;

      if (!res.ok) {
        setResponse("reject");
        setRejectMessage("Error al enviar la consulta.");
        return;
      }

      if (data.type === "reject") {
        setResponse("reject");
        setRejectMessage(data.message);
        return;
      }

      if (data.type === "clarify") {
        setResponse("clarify");
        setClarifyQuestions(data.questions ?? []);
        return;
      }

      if (data.type === "answer") {
        setResponse("answer");
        setContent(data.content ?? "");
      }
    } catch {
      setResponse("reject");
      setRejectMessage("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="query-panel" id="panel" ref={panelRef}>
      <div className="qp-header">
        <div className="qp-title">Consulta Legal</div>
        <div className="qp-badge">IA Activa</div>
      </div>
      <div className="qp-modes">
        <button
          type="button"
          className={`mode-pill ${!maxReliability ? "active" : ""}`}
          onClick={() => setMode(false)}
        >
          Normal
          <br />
          <span style={{ fontSize: "10px", opacity: 0.7 }}>Respuesta rápida</span>
        </button>
        <button
          type="button"
          className={`mode-pill ${maxReliability ? "active" : ""}`}
          onClick={() => setMode(true)}
        >
          Máxima Confiabilidad
          <br />
          <span style={{ fontSize: "10px", opacity: 0.7 }}>Verificación judicial</span>
        </button>
      </div>
      <div className="qp-body">
        <div className="qp-examples-label">Consultas frecuentes</div>
        <div className="qp-examples">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="qp-example" onClick={() => fillExample(q)}>
              {q}
            </button>
          ))}
        </div>
        <textarea
          className="qp-textarea"
          placeholder="Escribe tu consulta legal aquí...&#10;Puedes usar lenguaje cotidiano, no necesitas términos jurídicos."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
        />
        <button
          type="button"
          className="qp-submit"
          onClick={submit}
          disabled={loading || !input.trim()}
        >
          ⚖️ Analizar consulta
        </button>
      </div>

      {(loading || response !== "idle") && (
        <div className="qp-response" style={{ display: "block" }}>
          <div className="qp-response-head">
            <div className="qp-response-dot" />
            <div className="qp-response-lbl">Orientación Legal · InfoLegal RD</div>
          </div>
          <div className="qp-response-body">
            {loading && (
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
            )}
            {!loading && response === "reject" && (
              <p style={{ color: "var(--sage)" }}>{rejectMessage}</p>
            )}
            {!loading && response === "clarify" && (
              <>
                <p style={{ marginBottom: 8, color: "var(--off-white)" }}>Para precisar tu consulta:</p>
                <ul style={{ listStyle: "disc", paddingLeft: 20 }}>
                  {clarifyQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            {!loading && response === "answer" && content && (
              <div className="prose prose-invert max-w-none" style={{ color: "var(--off-white)" }}>
                {content.split("\n").map((line, i) => (
                  <p key={i} style={{ marginBottom: 8 }}>
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: "0 28px 20px" }}>
        <div className="qp-disclaimer">
          Orientación educativa únicamente. No constituye asesoría legal
          <br />
          ni relación abogado-cliente.
        </div>
      </div>
    </div>
  );
}
