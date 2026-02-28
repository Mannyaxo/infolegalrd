"use client";

import { useState, useRef, useEffect } from "react";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";
import { LegalResponse } from "@/components/chat/LegalResponse";

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
  const [lastQuery, setLastQuery] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [lastMode, setLastMode] = useState<"standard" | "max-reliability">("standard");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [ragProbeQuery, setRagProbeQuery] = useState("");
  const [ragProbeLoading, setRagProbeLoading] = useState(false);
  const [ragProbeResult, setRagProbeResult] = useState<{
    total: number;
    chunks: Array<{ title: string; source_url: string; canonical_key: string | null; chunk_index: number; textPreview: string }>;
    byCanonicalUsed?: boolean;
    askedCanonical?: string;
  } | null>(null);
  const [ragProbeError, setRagProbeError] = useState<string | null>(null);
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
      const chatMode = maxReliability ? "max-reliability" : "standard";
      const body = { message: text, history: [], userId: user?.id ?? null, mode: chatMode };
      console.log("Enviando mode:", body.mode);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        const answerContent = data.content ?? "";
        setContent(answerContent);
        setLastQuery(text);
        setLastResponse(answerContent);
        setLastMode(maxReliability ? "max-reliability" : "standard");
        setFeedbackSent(false);
      }
    } catch {
      setResponse("reject");
      setRejectMessage("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const runRagProbe = async () => {
    const q = (ragProbeQuery || input).trim();
    if (!q || ragProbeLoading) return;
    setRagProbeLoading(true);
    setRagProbeError(null);
    setRagProbeResult(null);
    try {
      const res = await fetch("/api/rag-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRagProbeError(data.error ?? "Error al probar RAG");
        return;
      }
      if (data.ok && Array.isArray(data.chunks)) {
        setRagProbeResult({
          total: data.total ?? 0,
          chunks: data.chunks,
          byCanonicalUsed: data.byCanonicalUsed,
          askedCanonical: data.askedCanonical,
        });
      } else {
        setRagProbeError("Respuesta inesperada del servidor");
      }
    } catch {
      setRagProbeError("Error de conexión");
    } finally {
      setRagProbeLoading(false);
    }
  };

  const sendFeedback = async () => {
    const text = feedbackText.trim();
    if (feedbackSending || feedbackSent) return;
    setFeedbackSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: lastQuery,
          response: lastResponse,
          feedback: text || "(sin texto)",
          timestamp: new Date().toISOString(),
          mode: lastMode,
          userId: user?.id ?? null,
        }),
      });
      if (res.ok) {
        setFeedbackSent(true);
        setFeedbackText("");
      }
    } catch {
      // silencioso
    } finally {
      setFeedbackSending(false);
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
                <LegalResponse content={content} />
              </div>
            )}
          </div>
        </div>
      )}

      {response === "answer" && content && (
        <div style={{ padding: "0 28px 16px", borderTop: "1px solid var(--border)" }}>
          <textarea
            placeholder="¿Qué te pareció la respuesta? ¿Algo incorrecto o que mejorar? (opcional)"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            disabled={feedbackSent}
            style={{
              width: "100%",
              minHeight: 56,
              padding: 10,
              fontSize: 12,
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              borderRadius: 6,
              color: "var(--off-white)",
              resize: "vertical",
            }}
          />
          <button
            type="button"
            onClick={sendFeedback}
            disabled={feedbackSending || feedbackSent}
            style={{
              marginTop: 8,
              padding: "6px 14px",
              fontSize: 12,
              background: feedbackSent ? "var(--sage-dim)" : "var(--surface2)",
              color: "var(--muted)",
              border: "1px solid var(--border2)",
              borderRadius: 6,
              cursor: feedbackSent ? "default" : "pointer",
            }}
          >
            {feedbackSent ? "Gracias" : "Enviar feedback"}
          </button>
        </div>
      )}

      <div style={{ padding: "0 28px 20px" }}>
        <div className="qp-disclaimer">
          Orientación educativa únicamente. No constituye asesoría legal
          <br />
          ni relación abogado-cliente.
        </div>
      </div>

      <details style={{ margin: "0 28px 20px", padding: "12px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border2)" }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Probar RAG (recuperación)</summary>
        <p style={{ marginTop: 8, marginBottom: 8, fontSize: 12, color: "var(--off-white)" }}>
          Ver qué chunks recupera el RAG para una consulta, sin enviar a la IA. Útil para afinar búsqueda.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder={input || "Escribe una consulta para probar"}
            value={ragProbeQuery}
            onChange={(e) => setRagProbeQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              padding: "8px 10px",
              fontSize: 12,
              background: "var(--surface2)",
              border: "1px solid var(--border2)",
              borderRadius: 6,
              color: "var(--off-white)",
            }}
          />
          <button
            type="button"
            onClick={runRagProbe}
            disabled={ragProbeLoading}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              background: "var(--surface2)",
              color: "var(--off-white)",
              border: "1px solid var(--border2)",
              borderRadius: 6,
              cursor: ragProbeLoading ? "wait" : "pointer",
            }}
          >
            {ragProbeLoading ? "Buscando…" : "Probar recuperación"}
          </button>
        </div>
        {ragProbeError && <p style={{ marginTop: 8, fontSize: 12, color: "var(--sage)" }}>{ragProbeError}</p>}
        {ragProbeResult && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <p style={{ color: "var(--muted)", marginBottom: 8 }}>
              <strong>{ragProbeResult.total}</strong> chunks
              {ragProbeResult.askedCanonical && ragProbeResult.byCanonicalUsed && (
                <span> (incl. por ley solicitada: {ragProbeResult.askedCanonical})</span>
              )}
            </p>
            <ul style={{ listStyle: "none", paddingLeft: 0, maxHeight: 280, overflowY: "auto" }}>
              {ragProbeResult.chunks.map((c, i) => (
                <li key={i} style={{ marginBottom: 10, padding: 8, background: "var(--surface2)", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, color: "var(--off-white)" }}>{c.title || "(sin título)"}</div>
                  {c.canonical_key && <span style={{ color: "var(--muted)", fontSize: 11 }}> {c.canonical_key}</span>}
                  <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 11 }}>{c.textPreview}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}
