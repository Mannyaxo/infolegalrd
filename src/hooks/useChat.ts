"use client";

import { useState, useCallback, useRef } from "react";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Solo para assistant: type "answer" | "clarify" | "reject" */
  responseType?: "answer" | "clarify" | "reject";
  /** Si type === "clarify" */
  questions?: string[];
};

export type ChatMode = "normal" | "max-reliability";

export type ApiChatResponse =
  | { type: "answer"; content: string; note?: string }
  | { type: "clarify"; questions: string[] }
  | { type: "reject"; message: string };

const AREAS = [
  "Todas",
  "Laboral",
  "Familia",
  "Inmobiliario",
  "Comercial",
  "Civil",
  "Penal",
  "Constitucional",
] as const;

export type AreaFilter = (typeof AREAS)[number];

function nextId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useChat(userId?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [mode, setMode] = useState<ChatMode>("normal");
  const [area, setArea] = useState<AreaFilter>("Todas");
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      abortRef.current = new AbortController();

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history,
            mode: mode === "max-reliability" ? "max-reliability" : "normal",
            userId: userId ?? null,
          }),
          signal: abortRef.current.signal,
        });
        const data = (await res.json()) as ApiChatResponse;

        if (data.type === "reject") {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: data.message,
              responseType: "reject",
            },
          ]);
          return;
        }

        if (data.type === "clarify") {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: "",
              responseType: "clarify",
              questions: data.questions ?? [],
            },
          ]);
          return;
        }

        if (data.type === "answer") {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: data.content ?? "",
              responseType: "answer",
            },
          ]);
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: "Error de conexión. Intenta de nuevo.",
            responseType: "reject",
          },
        ]);
      } finally {
        setIsTyping(false);
        abortRef.current = null;
      }
    },
    [messages, isTyping, mode, userId]
  );

  const resetChat = useCallback(() => {
    setMessages([]);
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsTyping(false);
  }, []);

  const addToHistory = useCallback((_title: string) => {
    // Mock: podrías persistir en localStorage o backend
  }, []);

  return {
    messages,
    isTyping,
    mode,
    setMode,
    area,
    setArea,
    sendMessage,
    resetChat,
    addToHistory,
    areas: AREAS,
  };
}
