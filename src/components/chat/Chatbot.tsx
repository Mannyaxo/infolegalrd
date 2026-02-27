"use client";

import { useState, useRef, useEffect } from "react";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";

type ApiResponse =
  | { type: "answer"; content: string; note?: string; mode?: string; decision?: string; questions?: string[]; confidence?: number; caveats?: string[]; next_steps?: string[]; risk_flags?: string[]; audit_summary?: string }
  | { type: "clarify"; questions: string[] }
  | { type: "reject"; message: string };

type LimitInfo = { permitido: boolean; usadas: number; limite: number };

function SendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
  );
}

type ChatbotProps = {
  suggestedQuery?: string;
  onSuggestionApplied?: () => void;
};

function getAreaFromText(text: string): string {
  const t = text.toLowerCase();
  if (/\b(empleado\s+público|map\b|ley\s+41-08|tsa\b|función\s+pública)\b/i.test(t)) return "Administrativo/Laboral público";
  if (/\b(contrato|arrendamiento|pago|comercial|obligación\s+contractual)\b/i.test(t)) return "Civil/Comercial";
  if (/\b(denuncia|fiscal|prisión|delito|penal)\b/i.test(t)) return "Penal";
  if (/\b(pensión|divorcio|custodia|alimentos|familia)\b/i.test(t)) return "Familia";
  if (/\b(residencia|visa|migración|extranjería)\b/i.test(t)) return "Migración";
  return "General";
}

function getNivel(decision?: string, confidence?: number): "Alto" | "Medio" | "Bajo" {
  if (decision === "NEED_MORE_INFO" || (typeof confidence === "number" && confidence < 0.65)) return "Alto";
  if (typeof confidence === "number" && confidence <= 0.8) return "Medio";
  return "Bajo";
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-700 dark:text-green-300";
  if (confidence >= 0.65) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

function getChecklistByArea(area: string): string[] {
  const map: Record<string, string[]> = {
    "Administrativo/Laboral público": ["Carta de nombramiento", "Contrato o acta de posesión", "Comunicaciones del empleador", "Reglamento interno", "Recibos de nómina"],
    "Civil/Comercial": ["Contrato (si aplica)", "Comprobantes de pago", "Correspondencia", "Facturas o presupuestos"],
    "Penal": ["Denuncia o querella", "Citación o notificación", "Documentos de identidad", "Pruebas que obren en su poder"],
    "Familia": ["Partida de nacimiento", "Acta de matrimonio o divorcio", "Comprobantes de ingresos", "Acuerdos previos (si existen)"],
    "Migración": ["Pasaporte vigente", "Visa o permiso actual", "Comprobante de residencia", "Documentos que acrediten vínculo"],
    "General": ["Identificación", "Documentos relacionados con su consulta", "Cualquier notificación o escrito relevante"],
  };
  return map[area] ?? map["General"];
}

const RESPONSE_HEADER = "⚖️ Orientación Legal Informativa — RD";

function formatResponseContent(content: string, needMoreInfoQuestions?: string[] | null) {
  const lines = content.split(/\n/).filter(Boolean);
  const summaryLines = lines.slice(0, 5);
  const restLines = lines.slice(5);
  const hasQuestions = needMoreInfoQuestions && needMoreInfoQuestions.length > 0;
  const questionsToShow = hasQuestions ? needMoreInfoQuestions.slice(0, 5) : [];
  return { summaryLines, restLines, questionsToShow };
}

export function Chatbot({ suggestedQuery, onSuggestionApplied }: ChatbotProps = {}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState<LimitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarifyQuestions, setClarifyQuestions] = useState<string[] | null>(null);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
  const [maxReliability, setMaxReliability] = useState(false);
  const [maxReliabilityMeta, setMaxReliabilityMeta] = useState<{
    decision?: string;
    confidence?: number;
    caveats?: string[];
    next_steps?: string[];
    risk_flags?: string[];
    questions?: string[];
  } | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"respuesta" | "preguntas" | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = useSupabase();
  const { user } = useAuth(supabase);

  const fetchLimit = async () => {
    const id = user?.id ?? "";
    const res = await fetch(`/api/consultas-limit?userId=${encodeURIComponent(id)}`);
    const data = await res.json();
    setLimit({ permitido: data.permitido, usadas: data.usadas ?? 0, limite: data.limite ?? 5 });
  };

  useEffect(() => {
    fetchLimit();
  }, [user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (suggestedQuery) {
      setInput(suggestedQuery);
      onSuggestionApplied?.();
    }
  }, [suggestedQuery, onSuggestionApplied]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (limit && limit.limite !== -1 && !limit.permitido) {
      setError("Has alcanzado el límite de consultas gratuitas por hoy. Inicia sesión o suscríbete para más.");
      return;
    }

    setError(null);
    setClarifyQuestions(null);
    setRejectMessage(null);
    setAnswerNote(null);
    setMaxReliabilityMeta(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const chatMode = maxReliability ? "max-reliability" : "standard";
      const body = { message: text, history: messages.slice(-10), userId: user?.id ?? null, mode: chatMode };
      console.log("Enviando mode:", body.mode);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiResponse;

      if (!res.ok) {
        setMessages((m) => m.slice(0, -1));
        setError("Error al enviar la consulta.");
        setInput(text);
        return;
      }

      if (data.type === "reject") {
        setMessages((m) => m.slice(0, -1));
        setRejectMessage(data.message);
        setInput(text);
        return;
      }

      if (data.type === "clarify") {
        setMessages((m) => m.slice(0, -1));
        setClarifyQuestions(data.questions);
        setInput("");
        return;
      }

      if (data.type === "answer" && data.note) {
        setAnswerNote(data.note);
      }
      if (data.type === "answer" && data.mode === "max-reliability") {
        setMaxReliabilityMeta({
          decision: data.decision,
          confidence: data.confidence,
          caveats: data.caveats,
          next_steps: data.next_steps,
          risk_flags: data.risk_flags,
          questions: data.questions,
        });
      } else {
        setMaxReliabilityMeta(null);
      }

      setShowChecklist(false);
      setMessages((m) => [...m, { role: "assistant", content: data.content }]);

      if (user?.id) {
        await fetch("/api/consultas-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        fetchLimit();
      }
    } catch {
      setMessages((m) => m.slice(0, -1));
      setError("Error de conexión. Intenta de nuevo.");
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const limitText =
    limit?.limite === -1
      ? "Consultas ilimitadas (premium)"
      : limit != null
        ? `Consultas hoy: ${limit.usadas} / ${limit.limite}`
        : "";

  return (
    <section className="w-full font-sans">
      <div className="rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800/50">
        {limitText && (
          <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400">{limitText}</p>
          </div>
        )}

        {/* Selector de modo tipo card */}
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-600">
          <p className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">Modo de respuesta</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMaxReliability(false)}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                !maxReliability
                  ? "border-[#1e40af] bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/20"
                  : "border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-slate-500"
              }`}
            >
              <span className="font-medium text-slate-900 dark:text-white">Normal Seguro</span>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Respuesta rápida estructurada
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMaxReliability(true)}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                maxReliability
                  ? "border-[#1e40af] bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/20"
                  : "border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-slate-500"
              }`}
            >
              <span className="font-medium text-slate-900 dark:text-white">Máxima Confiabilidad</span>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Revisión judicial adicional y verificación
              </p>
            </button>
          </div>
        </div>

        {/* Indicador de modo activo */}
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-600">
          {maxReliability ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-200">
              Revisión jurídica activa
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              Modo Normal
            </span>
          )}
        </div>

        <div className="flex min-h-[75vh] flex-col">
          <div
            className="flex-1 space-y-4 overflow-y-auto p-4 scroll-smooth"
            style={{ minHeight: "70vh" }}
          >
            {/* Panel Análisis del caso — solo cuando hay respuesta del asistente */}
            {messages.length > 0 && messages[messages.length - 1].role === "assistant" && (() => {
              const lastContent = messages[messages.length - 1].content;
              const area = getAreaFromText(lastContent);
              const confidence = maxReliabilityMeta?.confidence ?? 0.8;
              const nivel = getNivel(maxReliabilityMeta?.decision, confidence);
              const confPct = Math.round(confidence * 100);
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/50">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Análisis del caso</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">Área: {area}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">Nivel: {nivel}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">Modo: {maxReliability ? "Máxima Confiabilidad" : "Normal Seguro"}</span>
                    <span className={`rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium dark:border-slate-600 dark:bg-slate-700 ${getConfidenceColor(confidence)}`}>Confianza: {confPct}%</span>
                  </div>
                </div>
              );
            })()}
            {answerNote && (
              <div className="rounded-xl bg-slate-100 px-4 py-2 text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
                {answerNote}
              </div>
            )}
            {rejectMessage && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-100">
                {rejectMessage}
              </div>
            )}
            {clarifyQuestions && clarifyQuestions.length > 0 && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-400/30 dark:bg-sky-950/30 dark:text-sky-100">
                <p className="font-semibold">Para precisar el escenario hipotético:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {clarifyQuestions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400" style={{ lineHeight: 1.6 }}>
                Haz una pregunta general sobre derecho en República Dominicana.
              </p>
            )}
            {messages.map((msg, i) => {
              const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
              const needMoreInfo = isLastAssistant && maxReliabilityMeta?.decision === "NEED_MORE_INFO";
              const questions = maxReliabilityMeta?.questions ?? null;
              const { summaryLines, restLines, questionsToShow } = msg.role === "assistant"
                ? formatResponseContent(msg.content, needMoreInfo ? questions : null)
                : { summaryLines: [] as string[], restLines: [] as string[], questionsToShow: [] as string[] };

              return (
                <div key={i} className="space-y-2">
                  <div
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-[1rem] ${msg.role === "user"
                        ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
                        : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                      }`}
                      style={{ lineHeight: 1.6 }}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{RESPONSE_HEADER}</p>
                          {summaryLines.length > 0 && (
                            <>
                              <p className="font-medium text-slate-800 dark:text-slate-100">Resumen</p>
                              <p className="mb-3">{summaryLines.join("\n")}</p>
                            </>
                          )}
                          {needMoreInfo && questionsToShow.length > 0 && (
                            <>
                              <p className="mt-2 font-medium text-slate-800 dark:text-slate-100">Para orientar mejor necesito:</p>
                              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                {questionsToShow.map((q, idx) => (
                                  <li key={idx}>{q}</li>
                                ))}
                              </ul>
                              {restLines.length > 0 && <p className="mt-3">{restLines.join("\n")}</p>}
                            </>
                          )}
                          {!needMoreInfo && restLines.length > 0 && <p>{restLines.join("\n")}</p>}
                          {summaryLines.length === 0 && restLines.length === 0 && !(needMoreInfo && questionsToShow.length > 0) && <p>{msg.content}</p>}
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      )}
                    </div>
                  </div>
                  {/* Meta y botones solo en última respuesta del asistente */}
                  {isLastAssistant && maxReliabilityMeta && maxReliabilityMeta.decision !== "NEED_MORE_INFO" && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-600 dark:bg-slate-800/60">
                      {maxReliabilityMeta.decision && (
                        <p className="font-medium text-slate-700 dark:text-slate-200">Decisión: {maxReliabilityMeta.decision}</p>
                      )}
                      {typeof maxReliabilityMeta.confidence === "number" && (
                        <p className="mt-1 text-slate-600 dark:text-slate-300">Confianza: {(maxReliabilityMeta.confidence * 100).toFixed(0)}%</p>
                      )}
                      {maxReliabilityMeta.caveats && maxReliabilityMeta.caveats.length > 0 && (
                        <p className="mt-2 text-slate-600 dark:text-slate-300"><span className="font-medium">Salvedades:</span> {maxReliabilityMeta.caveats.join(" ")}</p>
                      )}
                      {maxReliabilityMeta.next_steps && maxReliabilityMeta.next_steps.length > 0 && (
                        <p className="mt-2 text-slate-600 dark:text-slate-300"><span className="font-medium">Próximos pasos:</span> {maxReliabilityMeta.next_steps.join(" ")}</p>
                      )}
                      {maxReliabilityMeta.risk_flags && maxReliabilityMeta.risk_flags.length > 0 && (
                        <p className="mt-2 text-amber-700 dark:text-amber-200"><span className="font-medium">Riesgos:</span> {maxReliabilityMeta.risk_flags.join(" ")}</p>
                      )}
                    </div>
                  )}
                  {/* Botones de acción debajo de la última respuesta */}
                  {isLastAssistant && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(messages[i].content);
                            setCopyFeedback("respuesta");
                            setTimeout(() => setCopyFeedback(null), 2000);
                          } catch {
                            setCopyFeedback(null);
                          }
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                      >
                        {copyFeedback === "respuesta" ? "✓ Copiado" : "Copiar respuesta"}
                      </button>
                      {questions && questions.length > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(questions.map((q, idx) => `${idx + 1}. ${q}`).join("\n"));
                              setCopyFeedback("preguntas");
                              setTimeout(() => setCopyFeedback(null), 2000);
                            } catch {
                              setCopyFeedback(null);
                            }
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                        >
                          {copyFeedback === "preguntas" ? "✓ Copiado" : "Copiar preguntas"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowChecklist((v) => !v)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                      >
                        Generar checklist de documentos
                      </button>
                    </div>
                  )}
                  {isLastAssistant && showChecklist && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/60">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Documentos sugeridos según área</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
                        {getChecklistByArea(getAreaFromText(messages[i].content)).map((doc, idx) => (
                          <li key={idx}>{doc}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-700">
                  <span className="text-sm text-slate-500">Generando respuesta...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="border-t border-slate-200 p-4 dark:border-slate-600">
            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder="Ej: ¿Pueden despedirme siendo empleado de carrera administrativa?"
                className="min-h-[64px] flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[1.1rem] shadow-lg placeholder:text-slate-400 focus:border-[#1e40af] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 dark:border-slate-600 dark:bg-slate-100 dark:text-slate-900 dark:placeholder:text-slate-500"
                disabled={loading}
                style={{ lineHeight: 1.6 }}
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex min-h-[64px] min-w-[64px] items-center justify-center rounded-2xl bg-[#1e3a8a] text-white shadow-lg transition-colors hover:bg-[#1e3a8a]/90 disabled:opacity-50 dark:bg-[#1e3a8a] dark:hover:bg-[#1e3a8a]/90"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
