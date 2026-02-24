import { NextRequest, NextResponse } from "next/server";

type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

type RejectResponse = { type: "reject"; message: string };
type ClarifyResponse = { type: "clarify"; questions: string[] };
type AnswerResponse = { type: "answer"; content: string; note?: string };
type ChatResponse = RejectResponse | ClarifyResponse | AnswerResponse;

const REJECT_MESSAGE =
  "Esta herramienta solo ofrece información general y educativa. Por favor, reformule la consulta de forma hipotética o consulte a un abogado colegiado.";

const ADVERTENCIA_FINAL_EXACTA =
  "Este análisis es orientativo y se basa únicamente en la información proporcionada de forma genérica. No constituye asesoramiento legal vinculante, no crea relación abogado-cliente y no sustituye la consulta con un abogado colegiado. Se recomienda encarecidamente acudir a un profesional habilitado para evaluar su caso concreto.";

const DISCLAIMER_HARD_RULES = `Eres un asistente informativo sobre derecho de República Dominicana. Tu rol es ÚNICAMENTE educativo e informativo.

Reglas estrictas:
- No des asesoría legal personalizada, no “diagnostiques” casos reales, no pidas ni uses datos personales identificables.
- Si la consulta es personal (\"¿qué debo hacer?\", \"en mi caso\"), responde pidiendo reformular de forma hipotética/general.
- Siempre escribe en español, con precisión y prudencia.
`;

const BUSQUEDA_PROMPT = (tema: string) =>
  `Busca y cita textualmente leyes, reglamentos, Constitución RD, jurisprudencia SCJ/TC con números y fechas, doctrina y actualizaciones 2026 relevantes a ${tema}. Prioriza fuentes oficiales: scj.gob.do, tc.gob.do, gacetaoficial.gob.do, mt.gob.do, map.gob.do. Si no puedes verificar una cita textual, indícalo explícitamente y no inventes números ni fechas.`;

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_PRIMARY_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent";
const GEMINI_FALLBACK_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const MODELS = {
  xai: "grok-beta",
  xai_fallback: "grok-4-1-fast-reasoning",
  openai_primary: "gpt-4o",
  openai_fallback: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  claude_primary: "claude-sonnet-4-5",
  claude_fallback: "claude-haiku-4-5-20251001",
  gemini_primary: "gemini-3-flash",
  gemini_fallback: "gemini-2.5-flash-lite",
} as const;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max = 2500): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function looksLikePII(text: string): boolean {
  const t = text;
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /\b(\+?\d{1,3}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}\b/;
  const cedula = /\b\d{3}-\d{7}-\d\b|\b\d{11}\b/;
  const addressHints =
    /\b(calle|av\.?|avenida|sector|residencial|apto|apartamento|edificio|km|kil[oó]metro|no\.?|número|dirección)\b/i;
  const exactDate = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;
  return email.test(t) || phone.test(t) || cedula.test(t) || addressHints.test(t) || exactDate.test(t);
}

function asksPersonalAdvice(text: string): boolean {
  const t = text.toLowerCase();
  const triggers = [
    "en mi caso",
    "para mi caso",
    "qué hago",
    "que hago",
    "qué debo hacer",
    "que debo hacer",
    "me conviene",
    "qué me recomiendas",
    "que me recomiendas",
    "mi situación",
    "mi situacion",
    "ayúdame con mi caso",
    "ayudame con mi caso",
  ];
  return triggers.some((x) => t.includes(x));
}

function shouldReject(userMessage: string): boolean {
  return looksLikePII(userMessage) || asksPersonalAdvice(userMessage);
}

function needsClarificationHeuristic(userMessage: string): boolean {
  const msg = normalizeText(userMessage);
  if (msg.length < 25) return true;
  const tooBroad =
    /^(divorcio|herencia|renuncia|despido|contrato|demanda|pensión|pension|alquiler|arrendamiento|colaborador)\b/i.test(msg);
  return tooBroad;
}

async function fetchJsonOrText(res: Response): Promise<{ json?: unknown; text?: string }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { json: await res.json().catch(() => undefined) };
  }
  return { text: await res.text().catch(() => "") };
}

async function callOpenAIStyle(params: {
  provider: string;
  envKey?: string;
  url: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<string> {
  const { provider, url, apiKey, model, system, user, temperature = 0.2, max_tokens = 1800 } = params;
  console.log(`[API ${provider}] Intentando model: ${model}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens,
    }),
  });

  if (!res.ok) {
    const parsed = await fetchJsonOrText(res);
    const errorDetail = typeof parsed.json === "object" && parsed.json && "error" in (parsed.json as object)
      ? String((parsed.json as { error?: { message?: string } }).error?.message ?? "sin mensaje")
      : parsed.text ?? "sin mensaje";
    console.error(`[API ${provider}] FALLO - status ${res.status} - detalle: ${errorDetail}`);
    if (res.status === 429) {
      console.error("OpenAI rate limit - considera agregar más crédito o usar fallback");
    }
    throw new Error(`Error LLM (${res.status})`);
  }

  console.log(`[API ${provider}] ÉXITO - status ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return text;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
};

async function callGemini(params: {
  provider: string;
  envKey?: string;
  modelLabel: string;
  url: string;
  apiKey: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const { provider, modelLabel, url, apiKey, user, temperature = 0.2, maxOutputTokens = 1800 } = params;
  console.log(`[API ${provider}] Intentando model: ${modelLabel}`);
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  });

  const parsed = await fetchJsonOrText(res);

  if (!res.ok) {
    const errorDetail = parsed.text ?? (parsed.json ? JSON.stringify(parsed.json) : "sin mensaje");
    console.error(`[API ${provider}] FALLO - status ${res.status} - detalle: ${errorDetail}`);
    throw new Error(`Error Gemini (${res.status})`);
  }

  const data = (parsed.json ?? {}) as GeminiResponse;

  if (data.promptFeedback?.blockReason) {
    console.warn(`[API ${provider}] Prompt bloqueado - blockReason: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    console.warn(`[API ${provider}] ÉXITO pero sin candidates`);
    return "";
  }

  if (candidate.finishReason && !/^STOP$/i.test(candidate.finishReason)) {
    console.warn(`[API ${provider}] finishReason: ${candidate.finishReason}`);
  }

  const parts = candidate.content?.parts ?? [];
  const text = parts
    .map((p) => (p && typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean)
    .join("")
    .trim();

  console.log(`[API ${provider}] ÉXITO - status ${res.status}`);
  return text;
}

async function callGeminiWithFallback(params: {
  apiKey: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  try {
    return await callGemini({
      provider: "Gemini-3-Flash",
      modelLabel: "gemini-3-flash",
      url: GEMINI_PRIMARY_URL,
      apiKey: params.apiKey,
      user: params.user,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
    });
  } catch (error) {
    console.warn("Gemini 3 Flash falló o llegó al límite, intentando con 2.5 Lite...");
    return await callGemini({
      provider: "Gemini-2.5-Lite",
      modelLabel: "gemini-2.5-flash-lite",
      url: GEMINI_FALLBACK_URL,
      apiKey: params.apiKey,
      user: params.user,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
    });
  }
}

async function callClaude(params: {
  provider: string;
  envKey?: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<string> {
  const { provider, apiKey, model, system, user, max_tokens = 1400, temperature = 0.2 } = params;
  console.log(`[API ${provider}] Intentando model: ${model}`);
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      temperature,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    }),
  });

  if (!res.ok) {
    const parsed = await fetchJsonOrText(res);
    const errorDetail = parsed.text ?? (parsed.json ? JSON.stringify(parsed.json) : "sin mensaje");
    console.error(`[API ${provider}] FALLO - status ${res.status} - detalle: ${errorDetail}`);
    throw new Error(`Error Claude (${res.status})`);
  }

  console.log(`[API ${provider}] ÉXITO - status ${res.status}`);
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const parts = (data.content ?? []).filter((c) => c.type === "text");
  const text = parts.map((c) => (c.text ?? "").trim()).join("").trim();
  return text;
}

async function callClaudeWithFallback(params: {
  apiKey: string;
  system: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<string> {
  try {
    return await callClaude({
      provider: "Claude",
      envKey: "ANTHROPIC_API_KEY",
      apiKey: params.apiKey,
      model: MODELS.claude_primary,
      system: params.system,
      user: params.user,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
    });
  } catch (error) {
    console.error("[API Claude] primary failed, trying fallback:", error);
    return await callClaude({
      provider: "Claude",
      envKey: "ANTHROPIC_API_KEY",
      apiKey: params.apiKey,
      model: MODELS.claude_fallback,
      system: params.system,
      user: params.user,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
    });
  }
}

function formatHistory(history: ChatHistoryMessage[] | undefined): string {
  if (!history || history.length === 0) return "";
  const last = history.slice(-10).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`);
  return truncate(last.join("\n"), 2000);
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      history?: ChatHistoryMessage[];
      userId?: string | null;
    };

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? body.history : [];

    if (!message) {
      return NextResponse.json({ type: "reject", message: REJECT_MESSAGE } satisfies ChatResponse, { status: 400 });
    }

    // A) Triage / rechazo ético (siempre primero)
    if (shouldReject(message)) {
      return NextResponse.json({ type: "reject", message: REJECT_MESSAGE } satisfies ChatResponse, { status: 200 });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const xaiKey = process.env.XAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!anthropicKey) {
      return NextResponse.json(
        { type: "reject", message: "Falta configuración del orquestador (ANTHROPIC_API_KEY)." } satisfies ChatResponse,
        { status: 503 }
      );
    }

    const historyText = formatHistory(history);

    // B) Clarificador con Claude
    const ambiguous = needsClarificationHeuristic(message);
    if (ambiguous) {
      const clarifierSystem =
        `${DISCLAIMER_HARD_RULES}\nEres un clarificador. Tu salida DEBE ser JSON válido, sin texto adicional.\n` +
        `Devuelve: {\"questions\": [\"...\", \"...\", \"...\"]} con máximo 3 preguntas genéricas.\n` +
        `Prohibido pedir nombres, cédulas, direcciones, teléfonos, correos o fechas exactas reales.`;

      const clarifierUser =
        `Consulta (formulada de manera general):\n${message}\n\n` +
        (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
        `Genera preguntas genéricas para precisar un escenario hipotético sin datos personales.`;

      const clarifierRaw = await callClaudeWithFallback({
        apiKey: anthropicKey,
        system: clarifierSystem,
        user: clarifierUser,
        max_tokens: 300,
        temperature: 0.1,
      });

      const parsed = safeJsonParse<{ questions?: unknown }>(clarifierRaw);
      const questions = Array.isArray(parsed?.questions)
        ? (parsed?.questions as unknown[])
            .filter((q) => typeof q === "string")
            .map((q) => normalizeText(q as string))
            .filter(Boolean)
            .slice(0, 3)
        : [];

      const fallbackQuestions =
        questions.length > 0
          ? questions
          : [
              "¿Se trata de un contrato verbal o escrito?",
              "¿Existe un plazo definido o es por tiempo indefinido?",
              "¿Había subordinación (horario, supervisión) o autonomía en la prestación del servicio?",
            ];

      return NextResponse.json({ type: "clarify", questions: fallbackQuestions } satisfies ChatResponse, { status: 200 });
    }

    // C) Investigación paralela (solo si hay contexto suficiente)
    const tema = truncate(message, 180);
    const promptBusqueda = BUSQUEDA_PROMPT(tema);
    const baseUser =
      `${DISCLAIMER_HARD_RULES}\n` +
      `Tema/pregunta (general): ${message}\n\n` +
      (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
      `Instrucción:\n${promptBusqueda}`;

    const tasks: Array<Promise<{ agent: string; ok: true; content: string } | { agent: string; ok: false; error: string }>> =
      [];

    if (xaiKey) {
      const xaiCall = async () => {
        try {
          return await callOpenAIStyle({
            provider: "xAI Grok",
            envKey: "XAI_API_KEY",
            url: XAI_URL,
            apiKey: xaiKey,
            model: MODELS.xai,
            system: "Eres un agente de búsqueda jurídica. Responde con citas y fuentes oficiales cuando sea posible.",
            user: baseUser,
            temperature: 0.2,
            max_tokens: 1800,
          });
        } catch (e) {
          console.error("[API xAI Grok] primary failed, trying fallback:", e);
          return await callOpenAIStyle({
            provider: "xAI Grok",
            envKey: "XAI_API_KEY",
            url: XAI_URL,
            apiKey: xaiKey,
            model: MODELS.xai_fallback,
            system: "Eres un agente de búsqueda jurídica. Responde con citas y fuentes oficiales cuando sea posible.",
            user: baseUser,
            temperature: 0.2,
            max_tokens: 1800,
          });
        }
      };
      tasks.push(
        xaiCall()
          .then((content) => ({ agent: "xAI Grok", ok: true as const, content }))
          .catch((e) => ({ agent: "xAI Grok", ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      );
    } else {
      tasks.push(Promise.resolve({ agent: "xAI Grok", ok: false as const, error: "Falta XAI_API_KEY" }));
    }

    if (geminiKey) {
      tasks.push(
        callGeminiWithFallback({ apiKey: geminiKey, user: baseUser, temperature: 0.2, maxOutputTokens: 1800 })
          .then((content) => ({ agent: "Gemini", ok: true as const, content }))
          .catch((e) => ({ agent: "Gemini", ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      );
    } else {
      tasks.push(Promise.resolve({ agent: "Gemini", ok: false as const, error: "Falta GEMINI_API_KEY" }));
    }

    if (openaiKey) {
      const openaiCall = async () => {
        try {
          return await callOpenAIStyle({
            provider: "OpenAI",
            envKey: "OPENAI_API_KEY",
            url: OPENAI_URL,
            apiKey: openaiKey,
            model: MODELS.openai_primary,
            system: "Eres un agente de búsqueda jurídica. Responde con citas verificables; no inventes.",
            user: baseUser,
            temperature: 0.2,
            max_tokens: 1800,
          });
        } catch (e) {
          console.error("[API OpenAI] primary failed, trying fallback:", e);
          return await callOpenAIStyle({
            provider: "OpenAI",
            envKey: "OPENAI_API_KEY",
            url: OPENAI_URL,
            apiKey: openaiKey,
            model: MODELS.openai_fallback,
            system: "Eres un agente de búsqueda jurídica. Responde con citas verificables; no inventes.",
            user: baseUser,
            temperature: 0.2,
            max_tokens: 1800,
          });
        }
      };
      tasks.push(
        openaiCall()
          .then((content) => ({ agent: "OpenAI", ok: true as const, content }))
          .catch((e) => ({ agent: "OpenAI", ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      );
    } else {
      tasks.push(Promise.resolve({ agent: "OpenAI", ok: false as const, error: "Falta OPENAI_API_KEY" }));
    }

    if (groqKey) {
      tasks.push(
        callOpenAIStyle({
          provider: "Groq",
          envKey: "GROQ_API_KEY",
          url: GROQ_URL,
          apiKey: groqKey,
          model: MODELS.groq,
          system: "Eres un agente de búsqueda jurídica. Cita fuentes oficiales si puedes; no inventes.",
          user: baseUser,
          temperature: 0.2,
          max_tokens: 1800,
        })
          .then((content) => ({ agent: "Groq", ok: true as const, content }))
          .catch((e) => ({ agent: "Groq", ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      );
    }

    const settled = await Promise.allSettled(tasks);
    const results = settled.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { agent: "unknown", ok: false as const, error: r.reason ? String(r.reason) : "unknown" }
    );

    const TOTAL_AGENTS = 5;
    // Incluye como OK cuando el primario falla pero el fallback responde (cada task ya resuelve con ok: true en ese caso)
    const successCount = results.filter((r) => r.ok).length;
    const failCount = Math.max(0, TOTAL_AGENTS - successCount);
    const successAgents = results.filter((r) => r.ok).map((r) => r.agent);
    const usedModels = successAgents;
    console.log(
      `Resumen consulta: Agentes OK: ${successCount}/5 | Fallidos: ${failCount} | Modelos usados: ${usedModels.join(", ")}`
    );

    // D) Síntesis final con Claude (juez)
    const judgeSystem =
      `${DISCLAIMER_HARD_RULES}\n` +
      `Eres el juez/sintetizador final. Debes producir una respuesta educativa y general sobre derecho dominicano.\n` +
      `PROHIBIDO: asesoría personalizada, instrucciones para evadir la ley, pedir datos personales.\n\n` +
      `Tu salida debe tener EXACTAMENTE estos 5 bloques numerados y en este orden:\n` +
      `1. Resumen breve de la consulta\n` +
      `2. Normativa aplicable (citas textuales de artículos, leyes, reglamentos, Constitución, jurisprudencia con números y fechas)\n` +
      `3. Análisis jurídico detallado (hechos genéricos → calificación → consecuencias → riesgos)\n` +
      `4. Recomendaciones prácticas y pasos concretos (siempre generales, nunca personalizados)\n` +
      `5. Advertencia final obligatoria (en negrita y destacada):\n` +
      `**\"${ADVERTENCIA_FINAL_EXACTA}\"**\n\n` +
      `Si alguna cita no puede verificarse con certeza, dilo y sugiere verificar en fuentes oficiales. No inventes artículos, números de sentencia ni fechas.`;

    const judgeUser =
      `Consulta (general):\n${message}\n\n` +
      (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
      `Resultados de agentes (pueden contener errores; verifica y sintetiza):\n\n` +
      results
        .map((r) =>
          r.ok
            ? `=== ${r.agent} (OK) ===\n${truncate(r.content, 4000)}\n`
            : `=== ${r.agent} (FALLÓ) ===\nError: ${r.error}\n`
        )
        .join("\n");

    const claudeFallbackNote = `Respuesta generada sin Claude (fallo temporal). Datos de ${successCount} agentes disponibles.`;
    let final: string;
    let note: string | undefined =
      failCount > 0
        ? `Nota informativa: Se usaron datos de ${successCount} de 5 agentes (algunos servicios no respondieron temporalmente). La respuesta sigue siendo válida con la información disponible.`
        : undefined;

    try {
      console.log(`[Claude] Solicitando max_tokens: 8192`);
      final = await callClaudeWithFallback({
        apiKey: anthropicKey,
        system: judgeSystem,
        user: judgeUser,
        max_tokens: 8192,
        temperature: 0.2,
      });
    } catch (claudeErr) {
      console.error("[API Claude] Síntesis falló, usando fallback con otros agentes:", claudeErr);
      const fallbackSystem =
        `${DISCLAIMER_HARD_RULES}\nSintetiza en español la siguiente información en una respuesta educativa breve con: 1) Resumen, 2) Normativa aplicable, 3) Análisis jurídico, 4) Recomendaciones prácticas, 5) Advertencia final: "${ADVERTENCIA_FINAL_EXACTA}".`;
      const fallbackUser = `Consulta: ${message}\n\nDatos disponibles:\n${results.filter((r) => r.ok).map((r) => `${r.agent}:\n${truncate(r.content, 3000)}`).join("\n\n")}`;
      let fallbackContent = "";
      if (openaiKey) {
        try {
          fallbackContent = await callOpenAIStyle({
            provider: "OpenAI",
            envKey: "OPENAI_API_KEY",
            url: OPENAI_URL,
            apiKey: openaiKey,
            model: MODELS.openai_primary,
            system: fallbackSystem,
            user: fallbackUser,
            max_tokens: 1800,
            temperature: 0.2,
          });
        } catch {
          try {
            fallbackContent = await callOpenAIStyle({
              provider: "OpenAI",
              envKey: "OPENAI_API_KEY",
              url: OPENAI_URL,
              apiKey: openaiKey,
              model: MODELS.openai_fallback,
              system: fallbackSystem,
              user: fallbackUser,
              max_tokens: 1800,
              temperature: 0.2,
            });
          } catch {
            // seguir con Groq/xAI
          }
        }
      }
      if (!fallbackContent && groqKey) {
        try {
          fallbackContent = await callOpenAIStyle({
            provider: "Groq",
            envKey: "GROQ_API_KEY",
            url: GROQ_URL,
            apiKey: groqKey,
            model: MODELS.groq,
            system: fallbackSystem,
            user: fallbackUser,
            max_tokens: 1800,
            temperature: 0.2,
          });
        } catch {
          // seguir con xAI
        }
      }
      if (!fallbackContent && xaiKey) {
        try {
          fallbackContent = await callOpenAIStyle({
            provider: "xAI Grok",
            envKey: "XAI_API_KEY",
            url: XAI_URL,
            apiKey: xaiKey,
            model: MODELS.xai,
            system: fallbackSystem,
            user: fallbackUser,
            max_tokens: 1800,
            temperature: 0.2,
          });
        } catch {
          // último recurso
        }
      }
      final = fallbackContent || `No se pudo generar respuesta (Claude y alternativas fallaron). Datos de ${successCount} agentes recibidos.`;
      note = claudeFallbackNote;
    }

    if (note) {
      final = `${note}\n\n${final}`;
    }

    console.log("Resumen final: Total agentes contribuyentes: " + successCount + "/5");
    return NextResponse.json({ type: "answer", content: final, note } satisfies ChatResponse, { status: 200 });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error);
    return NextResponse.json({ type: "reject", message: error.message || "Error en el orquestador" } satisfies ChatResponse, {
      status: 500,
    });
  }
}
