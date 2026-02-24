"use client";

import { useState, useRef, useEffect } from "react";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";

type ApiResponse =
  | { type: "answer"; content: string; note?: string }
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

export function Chatbot() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState<LimitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarifyQuestions, setClarifyQuestions] = useState<string[] | null>(null);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
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
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-10),
          userId: user?.id ?? null,
        }),
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
    <section className="mx-auto w-[90%] max-w-[1200px] font-sans">
      <div className="rounded-xl border border-slate-200 bg-[#f9fafb] shadow-lg dark:border-slate-600 dark:bg-slate-800/50">
        {limitText && (
          <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400">{limitText}</p>
          </div>
        )}

        <div className="flex min-h-[75vh] flex-col">
          <div
            className="flex-1 space-y-4 overflow-y-auto p-4 scroll-smooth"
            style={{ minHeight: "70vh" }}
          >
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
            {messages.map((msg, i) => (
              <div
                key={i}
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
                      {msg.content}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
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
                placeholder="Ej.: ¿Qué es la renuncia laboral en RD?"
                className="min-h-[60px] flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-[1.1rem] placeholder:text-slate-400 focus:border-[#1e40af] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 dark:border-slate-600 dark:bg-slate-800 dark:placeholder:text-slate-500"
                disabled={loading}
                style={{ lineHeight: 1.6 }}
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-xl bg-[#1e40af] text-white transition-colors hover:bg-[#1e3a8a] disabled:opacity-50 dark:bg-[#1e40af] dark:hover:bg-[#1e3a8a]"
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
