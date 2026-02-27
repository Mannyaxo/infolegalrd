import { NextRequest, NextResponse } from "next/server";
import { DISCLAIMER_PREFIX } from "@/lib/chat-guardrails";
import {
  embedQuery,
  retrieveVigenteChunks,
  retrieveVigenteChunksWithEmbedding,
  formatVigenteContext,
  formatMaxReliabilityContext,
  type VigenteChunk,
} from "@/lib/rag/vigente";
import { getSupabaseServer } from "@/lib/supabase/server";

type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

type RejectResponse = { type: "reject"; message: string };
type ClarifyResponse = { type: "clarify"; questions: string[] };
type AnswerResponse = { type: "answer"; content: string; note?: string };
type ChatResponse = RejectResponse | ClarifyResponse | AnswerResponse;

const ADVERTENCIA_FINAL_EXACTA =
  "Este análisis es orientativo y se basa únicamente en la información proporcionada de forma genérica. No constituye asesoramiento legal vinculante, no crea relación abogado-cliente y no sustituye la consulta con un abogado colegiado. Se recomienda encarecidamente acudir a un profesional habilitado para evaluar su caso concreto.";

const DISCLAIMER_HARD_RULES = `Eres un asistente informativo sobre derecho de República Dominicana. Tu rol es ÚNICAMENTE educativo e informativo.

Reglas estrictas:
- No des asesoría legal personalizada, no “diagnostiques” casos reales, no pidas ni uses datos personales identificables.
- Si la consulta es personal (\"¿qué debo hacer?\", \"en mi caso\"), responde pidiendo reformular de forma hipotética/general.
- Siempre escribe en español, con precisión y prudencia.
`;

/** Estructura obligatoria de respuesta RAG: asistente jurídico práctico para ciudadanos. */
const RAG_RESPONSE_STRUCTURE = `
ESTRUCTURA OBLIGATORIA DE RESPUESTA (respeta siempre este orden):

1️⃣ CONCLUSIÓN DIRECTA
- Respuesta clara en 3–5 líneas.
- Indica si la situación parece legal, irregular o posiblemente abusiva.

2️⃣ BASE LEGAL
- Cita artículos específicos solo si aparecen en el contexto proporcionado.
- Indica ley o Constitución y número de artículo cuando esté disponible.
- Si no hay base suficiente en el contexto, dilo claramente (ej. "No consta en las fuentes cargadas").

3️⃣ CÓMO PROCEDER (PASO A PASO)
- Paso 1, Paso 2, Paso 3...
- Indica documentos o acciones concretas cuando el contexto lo permita.

4️⃣ SI LA INSTITUCIÓN NO RESPONDE
- Vías administrativas, recursos disponibles, instancias competentes (solo si aplica y hay base en el contexto).

5️⃣ RIESGOS O PRECAUCIONES
- Advertencias prácticas y qué no hacer.

REGLAS DE REDACCIÓN:
- No inventes artículos ni procedimientos. Solo cita lo que esté en el contexto/metadatos.
- Tono profesional, firme y práctico. Evita lenguaje excesivamente académico.
- Prioriza normas de mayor jerarquía: Constitución > Ley > Decreto.
- Si falta información para una sección, indica "No hay información suficiente en las fuentes cargadas" en esa parte.
`;

const BUSQUEDA_PROMPT = (tema: string) =>
  `Busca y cita textualmente leyes, reglamentos, Constitución RD, jurisprudencia SCJ/TC con números y fechas, doctrina y actualizaciones 2026 relevantes a ${tema}. Prioriza fuentes oficiales: scj.gob.do, tc.gob.do, gacetaoficial.gob.do, mt.gob.do, map.gob.do.
CRÍTICO: NUNCA inventes o resumas el contenido de un artículo de ley por tu cuenta. Si no tienes el texto literal del artículo frente a ti, escribe "El contenido exacto del artículo [X] debe verificarse en la Gaceta Oficial o en el texto oficial de la ley" en lugar de redactar un resumen. Los números de artículos y su contenido real no siempre coinciden entre leyes; atribuir contenido a un artículo sin verificación genera errores graves. Si no puedes verificar una cita textual, indícalo explícitamente y no inventes números ni fechas.`;

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_PRIMARY_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const GEMINI_FALLBACK_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const MODELS = {
  xai: "grok-beta",
  xai_fallback: "grok-4-1-fast-reasoning",
  openai_primary: "gpt-4o",
  openai_fallback: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  claude_primary: "claude-sonnet-4-5",
  claude_fallback: "claude-haiku-4-5-20251001",
  gemini_primary: "gemini-2.0-flash",
  gemini_fallback: "gemini-1.5-flash",
} as const;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max = 2500): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

const OFFICIAL_SITES_RD = "site:gacetaoficial.gob.do OR site:tc.gob.do OR site:map.gob.do OR site:scj.gob.do";

/**
 * Búsqueda en tiempo real en fuentes oficiales RD para verificar citas y reducir alucinaciones.
 * Usa Serper (Google Search API) si SERPER_API_KEY está definida; si no, devuelve vacío.
 */
async function searchOfficialSourcesRD(tema: string): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey || !tema.trim()) return "";

  const query = `${tema.trim()} ley República Dominicana ${OFFICIAL_SITES_RD}`.slice(0, 200);
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { organic?: Array<{ title?: string; snippet?: string; link?: string }> };
    const organic = data.organic ?? [];
    const snippets = organic
      .map((o) => [o.title, o.snippet].filter(Boolean).join(": "))
      .filter(Boolean)
      .slice(0, 10);
    const text = snippets.join("\n\n");
    return text ? truncate(text, 3500) : "";
  } catch {
    return "";
  }
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
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const { provider, modelLabel, url, apiKey, user, system, temperature = 0.2, maxOutputTokens = 1800 } = params;
  console.log(`[API ${provider}] Intentando model: ${modelLabel}`);
  const body: { contents: unknown[]; generationConfig: { temperature: number; maxOutputTokens: number }; systemInstruction?: { parts: Array<{ text: string }> } } = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature, maxOutputTokens },
  };
  if (system && system.trim()) {
    body.systemInstruction = { parts: [{ text: system.trim() }] };
  }
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  try {
    return await callGemini({
      provider: "Gemini-2.0-Flash",
      modelLabel: "gemini-2.0-flash",
      url: GEMINI_PRIMARY_URL,
      apiKey: params.apiKey,
      user: params.user,
      system: params.system,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
    });
  } catch (error) {
    console.warn("Gemini 2.0 Flash falló, intentando con 1.5 Flash...");
    return await callGemini({
      provider: "Gemini-1.5-Flash",
      modelLabel: "gemini-1.5-flash",
      url: GEMINI_FALLBACK_URL,
      apiKey: params.apiKey,
      user: params.user,
      system: params.system,
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

/** Extrae JSON de texto que puede venir envuelto en ```json ... ``` */
function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(trimmed);
  const toParse = codeBlock ? codeBlock[1].trim() : trimmed;
  return safeJsonParse<T>(toParse);
}

const MAX_RELIABILITY_DISCLAIMER =
  "Modo experimental de máxima confiabilidad. Respuesta revisada por juez, pero sigue siendo información general, no asesoría legal.";

/** topK para RAG en ambos modos (siempre retrieval con match_vigente_chunks). */
const RAG_TOP_K = 8;

type MaxReliabilityCitation = {
  instrument: string;
  type: string;
  number: string | null;
  published_date: string;
  status: string;
  source_url: string;
  chunk_index: number;
};

type MaxReliabilityPayload = {
  decision: "APPROVE" | "NEED_MORE_INFO" | "NO_EVIDENCE" | "UNVERIFIED_CITATION";
  confidence: number;
  answer: string;
  missing_info_questions?: string[];
  caveats?: string[];
  next_steps?: string[];
  citations?: MaxReliabilityCitation[];
};

/** Extrae menciones de artículos (Art. N, Artículo N) para post-check. */
function extractArticleMentions(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ");
  const artDot = Array.from(normalized.matchAll(/(?:art\.?\s*\d+(?:-\d+)?)/gi), (m) => m[0].replace(/\s+/g, " ").toLowerCase());
  const articulo = Array.from(normalized.matchAll(/(?:artículo\s*\d+(?:-\d+)?)/gi), (m) => m[0].replace(/\s+/g, " ").toLowerCase());
  const seen = new Set<string>();
  for (let i = 0; i < artDot.length; i++) if (artDot[i]) seen.add(artDot[i]);
  for (let i = 0; i < articulo.length; i++) if (articulo[i]) seen.add(articulo[i]);
  return Array.from(seen);
}

/** Verifica que cada mención de artículo aparezca literalmente en el texto de los chunks (case-insensitive). */
function allArticleMentionsInText(mentions: string[], chunkText: string): boolean {
  const lower = chunkText.toLowerCase();
  for (const m of mentions) {
    if (!m) continue;
    if (!lower.includes(m.toLowerCase())) return false;
  }
  return true;
}

/** Obtiene las menciones de artículos que NO aparecen en el texto de los chunks. */
function getUnverifiedArticleMentions(answerText: string, allChunkText: string): string[] {
  const mentions = extractArticleMentions(answerText);
  if (mentions.length === 0) return [];
  const lower = allChunkText.toLowerCase();
  return mentions.filter((m) => m && !lower.includes(m.toLowerCase()));
}

/**
 * Post-check anti-alucinación: elimina de la respuesta las partes que citan artículos
 * no presentes en los chunks y añade caveat.
 */
function stripUnverifiedArticlesAndAddCaveat(answerText: string, allChunkText: string): {
  cleaned: string;
  caveat: string;
} {
  const unverified = getUnverifiedArticleMentions(answerText, allChunkText);
  if (unverified.length === 0) return { cleaned: answerText, caveat: "" };
  const caveat =
    "Los siguientes artículos no pudieron verificarse en las fuentes oficiales cargadas: " +
    unverified.join(", ") +
    ".";
  const unverifiedLower = unverified.map((u) => u.toLowerCase());
  const sentences = answerText.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const low = s.toLowerCase();
    return !unverifiedLower.some((u) => low.includes(u));
  });
  const cleaned = kept.join(" ").replace(/\s+/g, " ").trim();
  return { cleaned, caveat };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      history?: ChatHistoryMessage[];
      userId?: string | null;
      mode?: string;
    };

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? body.history : [];
    const mode = typeof body.mode === "string" ? body.mode : undefined;

    if (!message) {
      return NextResponse.json(
        { type: "reject", message: "El mensaje no puede estar vacío." } satisfies ChatResponse,
        { status: 400 }
      );
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

    // RAG obligatorio en ambos modos (match_vigente_chunks, topK=8)
    let chunks: VigenteChunk[] = [];
    let ragError: Error | null = null;
    try {
      chunks = await retrieveVigenteChunks(message, RAG_TOP_K);
    } catch (e) {
      ragError = e instanceof Error ? e : new Error(String(e));
      console.error("[RAG] retrieveVigenteChunks failed:", ragError.message, ragError);
    }
    const ragContext = formatVigenteContext(chunks);
    const ragBlock = ragContext.text
      ? `\n\nContexto oficial (instrumentos vigentes):\n${truncate(ragContext.text, 8000)}\n\nRegla de metadata: No afirmes fechas de promulgación, número de Gaceta Oficial ni leyes de ratificación si esa información no aparece en los chunks o en la metadata (published_date/effective_date/source_url/gazette_ref). Si no está, di "no consta en el material recuperado". No inventes artículos ni procedimientos.${RAG_RESPONSE_STRUCTURE}\nResponde basándote SOLO en este contexto y con la estructura anterior.`
      : "";

    // ————— Modo Máxima Confiabilidad (anti-alucinación) —————
    if (mode === "max-reliability") {
      const supabase = getSupabaseServer();
      const retrievedChunks = chunks;

      // CAPA 1: Sin chunks — clarify con preguntas prácticas (no identificables)
      if (retrievedChunks.length === 0) {
        const keyQuestions = [
          "¿La exigencia está por escrito (circular/correo) o solo verbal?",
          "¿Te han indicado alguna consecuencia o sanción si no reportas?",
          "¿Esto ocurre en días libres, vacaciones o ambas?",
        ];
        try {
          if (supabase) {
            await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } }).from("legal_audit_log").insert({
              user_id: body.userId ?? null,
              mode: "max-reliability",
              query: message,
              decision: "NO_EVIDENCE",
              confidence: 0.95,
              citations: [],
              model_used: { reason: "no_chunks", details: ragError?.message ?? "rpc_returned_empty" },
              tokens_in: null,
              tokens_out: null,
            });
          }
        } catch {
          // no bloquear
        }
        return NextResponse.json({ type: "clarify", questions: keyQuestions } satisfies ChatResponse, { status: 200 });
      }

      const { contextText, allChunkText } = formatMaxReliabilityContext(retrievedChunks, 12000);
      const allowedSourceUrls = new Set(retrievedChunks.map((c) => (c.citation.source_url ?? "").trim()).filter(Boolean));

      // CAPA 2: Prompt restrictivo — salida JSON estricta + estructura práctica de respuesta
      const maxReliabilitySystem =
        `${DISCLAIMER_HARD_RULES}\n` +
        `Modo MÁXIMA CONFIABILIDAD. Reglas estrictas:\n` +
        `- SOLO puedes usar información presente en el CONTEXTO proporcionado.\n` +
        `- Está PROHIBIDO inventar números de artículos, nombres de leyes, fechas o citas.\n` +
        `- Si el número de artículo NO aparece literalmente en el contexto, NO lo menciones.\n` +
        `- Cada afirmación jurídica relevante debe tener al menos una cita del contexto.\n` +
        `- Si la evidencia es insuficiente o ambigua, devuelve NEED_MORE_INFO y preguntas concretas en missing_info_questions.\n` +
        `El campo "answer" DEBE seguir esta estructura (asistente jurídico práctico):\n` +
        `1) CONCLUSIÓN DIRECTA (3–5 líneas; indicar si parece legal, irregular o posiblemente abusivo).\n` +
        `2) BASE LEGAL (citar solo artículos que aparezcan en el contexto; ley/Constitución y número).\n` +
        `3) CÓMO PROCEDER (paso a paso; documentos o acciones concretas).\n` +
        `4) SI LA INSTITUCIÓN NO RESPONDE (vías administrativas, recursos, instancias competentes si aplica).\n` +
        `5) RIESGOS O PRECAUCIONES (advertencias prácticas, qué no hacer).\n` +
        `Tono profesional, firme y práctico. Sin lenguaje excesivamente académico. Prioriza Constitución > Ley > Decreto.\n` +
        `Tu salida DEBE ser ÚNICAMENTE un JSON válido, sin texto antes ni después. Schema exacto:\n` +
        `{\n` +
        `  "decision": "APPROVE" | "NEED_MORE_INFO" | "NO_EVIDENCE",\n` +
        `  "confidence": number (0-1),\n` +
        `  "answer": string,\n` +
        `  "missing_info_questions": string[],\n` +
        `  "caveats": string[],\n` +
        `  "next_steps": string[],\n` +
        `  "citations": [{"instrument": string, "type": string, "number": string|null, "published_date": string, "status": string, "source_url": string, "chunk_index": number}]\n` +
        `}\n` +
        `Las citations SOLO pueden ser de los chunks del contexto (mismo instrument/title, source_url y chunk_index que aparecen en el contexto).`;

      const maxReliabilityUser =
        `Consulta del usuario:\n${message}\n\n` +
        (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
        `CONTEXTO (instrumentos vigentes — solo puedes citar esto):\n${contextText}\n\n` +
        `Responde ÚNICAMENTE con el JSON del schema anterior.`;

      const MAX_RELIABILITY_AGENT_TIMEOUT_MS = 8000;
      let modelRaw: string;
      try {
        modelRaw = await Promise.race([
          callClaudeWithFallback({
            apiKey: anthropicKey,
            system: maxReliabilitySystem,
            user: maxReliabilityUser,
            max_tokens: 4096,
            temperature: 0.1,
          }),
          new Promise<string>((_, rej) =>
            setTimeout(() => rej(new Error(`Timeout ${MAX_RELIABILITY_AGENT_TIMEOUT_MS}ms`)), MAX_RELIABILITY_AGENT_TIMEOUT_MS)
          ),
        ]);
      } catch (e) {
        console.error("[max-reliability] Modelo falló:", e instanceof Error ? e.message : String(e));
        const fallbackPayload = {
          ok: true as const,
          mode: "max-reliability" as const,
          decision: "NO_EVIDENCE" as const,
          confidence: 0.85,
          answer: "No se pudo generar una respuesta verificable. El modelo no respondió correctamente.",
          citations: [] as MaxReliabilityCitation[],
          caveats: ["Error al invocar el modelo; no se emitió criterio."],
          next_steps: ["Vuelve a intentar en unos momentos."],
        };
        try {
          if (supabase) {
            await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } }).from("legal_audit_log").insert({
              user_id: body.userId ?? null,
              mode: "max-reliability",
              query: message,
              decision: "NO_EVIDENCE",
              confidence: 0.85,
              citations: [],
              model_used: { error: "model_failed" },
              tokens_in: null,
              tokens_out: null,
            });
          }
        } catch {
          // no bloquear
        }
        return NextResponse.json(fallbackPayload, { status: 200 });
      }

      let parsed = extractJson<MaxReliabilityPayload>(modelRaw) ?? safeJsonParse<MaxReliabilityPayload>(modelRaw);
      if (!parsed || typeof parsed !== "object") {
        parsed = {
          decision: "NO_EVIDENCE",
          confidence: 0.85,
          answer: "La respuesta del modelo no fue JSON válido. No se emite criterio para evitar errores.",
          missing_info_questions: [],
          caveats: ["Salida del modelo inválida; no se usó."],
          next_steps: ["Reformula la consulta o intenta de nuevo."],
          citations: [],
        };
      }

      let decision = parsed.decision === "APPROVE" || parsed.decision === "NEED_MORE_INFO" || parsed.decision === "NO_EVIDENCE" || parsed.decision === "UNVERIFIED_CITATION"
        ? parsed.decision
        : "NO_EVIDENCE";
      let confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
      let answer = typeof parsed.answer === "string" ? parsed.answer : "";
      let missingInfo = Array.isArray(parsed.missing_info_questions) ? parsed.missing_info_questions.filter((q) => typeof q === "string") : [];
      let caveats = Array.isArray(parsed.caveats) ? parsed.caveats.filter((c) => typeof c === "string") : [];
      let nextSteps = Array.isArray(parsed.next_steps) ? parsed.next_steps.filter((s) => typeof s === "string") : [];
      let citations: MaxReliabilityCitation[] = Array.isArray(parsed.citations)
        ? (parsed.citations as unknown[]).filter(
            (c): c is MaxReliabilityCitation =>
              typeof c === "object" &&
              c !== null &&
              "instrument" in c &&
              "source_url" in c &&
              "chunk_index" in c
          )
        : [];

      // Citations reales: solo source_url presentes en chunks
      citations = citations.filter((c) => allowedSourceUrls.has((c.source_url ?? "").trim()));

      // CAPA 3: Post-check — artículos no verificados: eliminar esa parte y añadir caveat
      const { cleaned: answerCleaned, caveat: articleCaveat } = stripUnverifiedArticlesAndAddCaveat(answer, allChunkText);
      if (articleCaveat) {
        decision = "UNVERIFIED_CITATION";
        confidence = 0.6;
        answer = answerCleaned + "\n\n**Nota:** " + articleCaveat;
        caveats = [...caveats, articleCaveat];
      }

      const finalCitationsForLog = citations.map((c) => ({
        title: c.instrument,
        source_url: c.source_url,
        published_date: c.published_date,
        status: c.status,
      }));

      let answerWithDisclaimer = `${MAX_RELIABILITY_DISCLAIMER}\n\n${answer}`;
      if (decision !== "NEED_MORE_INFO" && finalCitationsForLog.length > 0) {
        const fuentesLines = finalCitationsForLog.map(
          (c) => `- ${c.title} | ${c.source_url} | ${c.published_date} | ${c.status}`
        );
        answerWithDisclaimer += `\n\n---\n**Fuentes (Citations):**\n${fuentesLines.join("\n")}`;
      }

      const payload = {
        type: "answer" as const,
        content: DISCLAIMER_PREFIX + answerWithDisclaimer,
        mode: "max-reliability" as const,
        ok: true as const,
        decision,
        answer: answerWithDisclaimer,
        questions: missingInfo,
        confidence,
        caveats,
        next_steps: nextSteps,
        citations: finalCitationsForLog,
      };

      try {
        if (supabase) {
          await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } }).from("legal_audit_log").insert({
            user_id: body.userId ?? null,
            mode: "max-reliability",
            query: message,
            decision: payload.decision,
            confidence: payload.confidence,
            citations: finalCitationsForLog,
            model_used: { judge: "claude" },
            tokens_in: null,
            tokens_out: null,
          });
        }
      } catch {
        // no bloquear respuesta por fallo de log
      }
      return NextResponse.json(payload, { status: 200 });
    }

    // Modo normal sin chunks: orientación práctica conservadora (5 bullets) + recomendar Máxima Confiabilidad
    if (chunks.length === 0) {
      const generalPrompt =
        `${DISCLAIMER_HARD_RULES}\nResponde con orientación práctica conservadora sobre derecho dominicano. NO pidas reformular en hipotético como requisito. NO cites artículos ni números de ley (no hay fuentes cargadas). Da 5 bullets concretos y prácticos que un ciudadano pueda seguir, sin datos personales. Tono profesional y directo.`;
      let generalAnswer = "";
      try {
        generalAnswer = await callClaudeWithFallback({
          apiKey: anthropicKey,
          system: generalPrompt,
          user: `Consulta: ${message}\n\nResponde en 5 bullets (acciones o recomendaciones prácticas).`,
          max_tokens: 500,
          temperature: 0.2,
        });
      } catch {
        generalAnswer =
          "• Consulta con un abogado colegiado para tu caso concreto.\n• Revisa el área legal que aplique (laboral, administrativo, etc.).\n• Conserva cualquier comunicación por escrito.\n• No firmes nada bajo presión sin asesoría.\n• Documenta fechas y hechos de forma objetiva.";
      }
      const withDisclaimer =
        DISCLAIMER_PREFIX +
        (generalAnswer.trim() || "Orientación general no disponible.") +
        "\n\n**Nota:** No encontré fuentes vigentes para citar artículos específicos. Para respuestas con base legal verificada, usa el modo **Máxima Confiabilidad** en la siguiente consulta.";
      return NextResponse.json({ type: "answer", content: withDisclaimer, note: undefined } satisfies ChatResponse, {
        status: 200,
      });
    }

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
      ragBlock +
      `\n\nInstrucción:\n${promptBusqueda}`;

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
            system: "Eres un agente de búsqueda jurídica. Responde con citas y fuentes oficiales cuando sea posible. NUNCA inventes el contenido de un artículo de ley: si no tienes el texto literal, indica que debe verificarse en la Gaceta Oficial (gacetaoficial.gob.do).",
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
            system: "Eres un agente de búsqueda jurídica. Responde con citas y fuentes oficiales cuando sea posible. NUNCA inventes el contenido de un artículo de ley: si no tienes el texto literal, indica que debe verificarse en la Gaceta Oficial (gacetaoficial.gob.do).",
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
            system: "Eres un agente de búsqueda jurídica. Responde con citas verificables; no inventes. NUNCA inventes el contenido de un artículo de ley: si no tienes el texto literal, indica que debe verificarse en la Gaceta Oficial (gacetaoficial.gob.do).",
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
            system: "Eres un agente de búsqueda jurídica. Responde con citas verificables; no inventes. NUNCA inventes el contenido de un artículo de ley: si no tienes el texto literal, indica que debe verificarse en la Gaceta Oficial (gacetaoficial.gob.do).",
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
          system: "Eres un agente de búsqueda jurídica. Cita fuentes oficiales si puedes; no inventes. NUNCA inventes el contenido de un artículo de ley: si no tienes el texto literal, indica que debe verificarse en la Gaceta Oficial (gacetaoficial.gob.do).",
          user: baseUser,
          temperature: 0.2,
          max_tokens: 1800,
        })
          .then((content) => ({ agent: "Groq", ok: true as const, content }))
          .catch((e) => ({ agent: "Groq", ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      );
    } else {
      tasks.push(Promise.resolve({ agent: "Groq", ok: false as const, error: "Falta GROQ_API_KEY" }));
    }

    // Búsqueda en fuentes oficiales RD (verificar citas, reducir alucinaciones)
    tasks.push(
      searchOfficialSourcesRD(tema)
        .then((content) => ({
          agent: "Búsqueda fuentes RD",
          ok: true as const,
          content: content || "(Sin resultados de búsqueda; no se dispone de SERPER_API_KEY o no hubo coincidencias.)",
        }))
        .catch((e) => ({
          agent: "Búsqueda fuentes RD",
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }))
    );

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

    // D) Síntesis final con Claude (juez) — Modo "Normal Seguro" — Estructura práctica
    const judgeSystem =
      `${DISCLAIMER_HARD_RULES}\n` +
      `Eres el juez/sintetizador final. Produce una respuesta orientada a la acción práctica sobre derecho dominicano, clara y estructurada.\n` +
      `PROHIBIDO: asesoría personalizada, instrucciones para evadir la ley, pedir datos personales.\n\n` +
      `REGLA ANTI-ALUCINACIÓN: NUNCA cites números de artículo ni plazos exactos a menos que aparezcan textualmente en "Búsqueda fuentes RD" o en las respuestas de los agentes. Si no está verificado, escribe en términos generales o indica "consulte la Gaceta Oficial". No inventes artículos ni procedimientos.\n\n` +
      `Estructura OBLIGATORIA de tu salida (asistente jurídico práctico para ciudadanos):\n` +
      `${RAG_RESPONSE_STRUCTURE}\n` +
      `Al final de la respuesta, añade en negrita la advertencia:\n**\"${ADVERTENCIA_FINAL_EXACTA}\"**\n\n` +
      `Tono profesional, firme y práctico. Sin lenguaje excesivamente académico. Prioriza Constitución > Ley > Decreto.`;

    const judgeUser =
      `Consulta (general):\n${message}\n\n` +
      (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
      `Resultados de agentes y búsqueda (pueden contener errores; verifica citas con "Búsqueda fuentes RD" si está disponible y sintetiza):\n\n` +
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
        `${DISCLAIMER_HARD_RULES}\nSintetiza en español con estructura práctica: 1) Conclusión directa (3-5 líneas), 2) Base legal (solo si está en los datos), 3) Cómo proceder paso a paso, 4) Si la institución no responde, 5) Riesgos o precauciones. No inventes artículos. Tono profesional y práctico. Advertencia final: "${ADVERTENCIA_FINAL_EXACTA}".`;
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

    // Post-check: artículos mencionados deben estar en chunks; si no, eliminar parte y caveat
    const allChunkTextStandard = chunks.map((c) => c.chunk_text).join("\n");
    const { cleaned: finalCleaned, caveat: standardCaveat } = stripUnverifiedArticlesAndAddCaveat(final, allChunkTextStandard);
    if (standardCaveat) {
      final = finalCleaned + "\n\n**Nota:** " + standardCaveat;
    } else {
      final = finalCleaned;
    }

    if (chunks.length > 0 && ragContext.citations.length > 0) {
      const fuentesLines = ragContext.citations.map(
        (c) => `- ${c.title} | ${c.source_url} | ${c.published_date} | ${c.status}`
      );
      final += `\n\n---\n**Fuentes (Citations):**\n${fuentesLines.join("\n")}`;
    }
    final = DISCLAIMER_PREFIX + final;

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
