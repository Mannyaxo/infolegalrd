import { NextRequest, NextResponse } from "next/server";
import { DISCLAIMER_PREFIX } from "@/lib/chat-guardrails";
import {
  embedQuery,
  retrieveVigenteChunks,
  retrieveVigenteChunksWithEmbedding,
  retrieveVigenteChunksByCanonicalKey,
  formatVigenteContext,
  formatMaxReliabilityContext,
  type VigenteChunk,
} from "@/lib/rag/vigente";
import { getSupabaseServer } from "@/lib/supabase/server";
import { enqueueForEnrichment } from "@/lib/enrichment/enqueue";
import { verifyAnswerClaims, stripUnverifiedArticlesAndAddCaveat } from "@/lib/claim-verification";
import {
  runMaxReliabilityPipeline,
  type MaxReliabilityCitation,
  type MaxReliabilityPipelineResult,
} from "@/lib/max-reliability-pipeline";

type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

type RejectResponse = { type: "reject"; message: string };
type ClarifyResponse = { type: "clarify"; questions: string[] };
export type RagSourceItem = { title: string; source_url: string; similarity?: number; textPreview: string };
type AnswerResponse = { type: "answer"; content: string; note?: string; sources?: RagSourceItem[] };
type ChatResponse = RejectResponse | ClarifyResponse | AnswerResponse;

function buildSourcesFromChunks(chunks: VigenteChunk[], maxPreview = 220): RagSourceItem[] {
  return chunks.slice(0, 10).map((c) => ({
    title: c.citation.title ?? "",
    source_url: c.citation.source_url ?? "",
    similarity: c.similarity,
    textPreview: c.chunk_text.slice(0, maxPreview) + (c.chunk_text.length > maxPreview ? "…" : ""),
  }));
}

const ADVERTENCIA_FINAL_EXACTA =
  "Este análisis es orientativo y se basa únicamente en la información proporcionada de forma genérica. No constituye asesoramiento legal vinculante, no crea relación abogado-cliente y no sustituye la consulta con un abogado colegiado. Se recomienda encarecidamente acudir a un profesional habilitado para evaluar su caso concreto.";

const DISCLAIMER_HARD_RULES = `Eres un asistente informativo sobre derecho de República Dominicana. Tu rol es ÚNICAMENTE educativo e informativo.

Reglas estrictas:
- No des asesoría legal personalizada, no “diagnostiques” casos reales, no pidas ni uses datos personales identificables.
- Si es muy personal y ambigua, pregunta datos genéricos sin pedir reformulación obligatoria; da pasos generales y disclaimer.
- Siempre escribe en español, con precisión y prudencia.
`;

/** Mensaje cuando no hay evidencia y se encola la consulta para auto-enriquecimiento. */
const MESSAGE_ENRICHMENT_PENDING =
  "No tengo esta norma completa en mi base verificada. Estoy buscando y verificando la versión oficial en fuentes gubernamentales. Vuelve a preguntar en 5-10 minutos.";

/** Estructura obligatoria de respuesta RAG: asistente jurídico práctico para ciudadanos. */
const RAG_RESPONSE_STRUCTURE = `
ESTRUCTURA OBLIGATORIA (respeta este orden; salida compacta):

1️⃣ CONCLUSIÓN DIRECTA — 3–4 líneas máximo. Indica si parece legal, irregular o posiblemente abusiva.

2️⃣ BASE LEGAL — Cita solo artículos que aparezcan en el contexto. Si no hay base suficiente, dilo en una línea.

3️⃣ CÓMO PROCEDER — Lista numerada 1–5 (pasos concretos: ej. "Solicita por escrito la base normativa", "Conserva correos/documentos", "Consulta abogado si aplica").

4️⃣ SI LA INSTITUCIÓN NO RESPONDE — 1–3 líneas si aplica (vías administrativas/recursos).

5️⃣ RIESGOS O PRECAUCIONES — Máx 5 bullets. Caveats y next_steps: máx 5 bullets cada uno.

REGLAS: No inventes artículos. Solo cita lo del contexto. Tono profesional y práctico. Prioriza Constitución > Ley > Decreto.
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

/** Normaliza query para dedup: trim, lowercase, colapsar espacios. */
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

/** Timeout con AbortController: aborta el fetch si existe signal; si no, usa Promise.race. */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const result = await fn(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      const err = new Error(`Timeout ${label} ${ms}ms`);
      console.error("[max-reliability] timeout:", label, "duración", ms, "ms");
      throw err;
    }
    throw e;
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
  signal?: AbortSignal;
}): Promise<string> {
  const { provider, apiKey, model, system, user, max_tokens = 1400, temperature = 0.2, signal } = params;
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
    signal,
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
  signal?: AbortSignal;
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
      signal: params.signal,
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
      signal: params.signal,
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
    const rawMode = typeof body.mode === "string" ? body.mode : "";
    const modeNorm = rawMode.trim().toLowerCase().replace(/[_\s]+/g, "-");
    const isMax =
      modeNorm === "max-reliability" ||
      modeNorm === "maxreliability" ||
      modeNorm === "max" ||
      modeNorm === "maximum-reliability" ||
      modeNorm === "máxima-confiabilidad" ||
      modeNorm === "maxima-confiabilidad";

    console.log("[chat] rawMode=", rawMode, "modeNorm=", modeNorm, "isMax=", isMax);

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

    // Si el usuario envió una respuesta muy corta (ej. "no no no") tras un clarify, usar la última pregunta del usuario como consulta real
    const lastAssistant = history.length > 0 && history[history.length - 1].role === "assistant";
    const lastUserContent = history.filter((m) => m.role === "user").pop()?.content?.trim() ?? "";
    const effectiveMessage =
      message.length <= 50 && lastAssistant && lastUserContent.length > 20
        ? lastUserContent
        : message;

    // RAG obligatorio en ambos modos (match_vigente_chunks, topK=8)
    let chunks: VigenteChunk[] = [];
    let ragError: Error | null = null;
    try {
      chunks = await retrieveVigenteChunks(effectiveMessage, RAG_TOP_K);
    } catch (e) {
      ragError = e instanceof Error ? e : new Error(String(e));
      console.error("[RAG] retrieveVigenteChunks failed:", ragError.message, ragError);
    }

    // Si el usuario pide una ley concreta (ley 590-16), traer chunks de esa ley por canonical_key
    // para que aparezca aunque la búsqueda semántica no la rankee alto (ej. ya ingestada por enrich)
    const askedLaw = message.match(/ley\s*(\d{2,3}-\d{2})/i);
    const askedCanonical = askedLaw ? `LEY-${askedLaw[1]}` : null;
    if (askedCanonical) {
      try {
        const byCanonical = await retrieveVigenteChunksByCanonicalKey(askedCanonical, RAG_TOP_K);
        if (byCanonical.length > 0) {
          const seen = new Set<string>();
          for (const c of byCanonical) {
            seen.add(`${c.citation.source_url ?? ""}|${c.chunk_index}`);
          }
          const rest = chunks.filter((c) => !seen.has(`${c.citation.source_url ?? ""}|${c.chunk_index}`));
          chunks = [...byCanonical, ...rest].slice(0, RAG_TOP_K);
          console.log("[DEBUG] Chunks tras merge por ley solicitada:", askedCanonical, "total:", chunks.length);
        } else {
          console.log("[DEBUG] No hay chunks por canonical_key", askedCanonical, "- ¿ley ingestada con ese key? Revisar instruments en Supabase.");
        }
      } catch (e) {
        console.warn("[RAG] retrieveVigenteChunksByCanonicalKey failed:", e);
      }
    }

    console.log("[DEBUG] Chunks recuperados:", chunks.length);
    if (chunks.length < 4) {
      console.log("[DEBUG] Encolando por falta de chunks suficientes");
      await enqueueForEnrichment(message, isMax ? "max-reliability" : "normal");
      return NextResponse.json({
        type: "answer",
        content:
          "No tengo esta norma completa en mi base verificada. Estoy buscando y verificando la versión oficial en fuentes gubernamentales. Vuelve a preguntar en 5–10 minutos.",
      });
    }

    const hasTheExactLaw = chunks.some(
      (c) =>
        c.citation.canonical_key === askedCanonical ||
        c.chunk_text.toLowerCase().includes("ley " + (askedLaw ? askedLaw[1] : ""))
    );
    if (askedCanonical && !hasTheExactLaw) {
      console.log("[DEBUG] Detectada ley faltante:", askedCanonical);
      await enqueueForEnrichment(message, isMax ? "max-reliability" : "normal");
      return NextResponse.json({
        type: "answer",
        content: `No tengo la Ley ${askedLaw ? askedLaw[1] : ""} completa en mi base verificada. Estoy buscando y verificando la versión oficial en fuentes gubernamentales. Vuelve a preguntar en 5–10 minutos.`,
      });
    }

    const ragContext = formatVigenteContext(chunks);
    const ragText = ragContext.text || "(No hay fuentes vigentes cargadas)";
    const ragCitations = ragContext.citations;
    const ragBlock = ragContext.text
      ? `\n\nContexto oficial verificado (solo puedes citar esto):\n${truncate(ragContext.text, 8000)}\n\nRegla de metadata: No afirmes fechas de promulgación, número de Gaceta Oficial ni leyes de ratificación si esa información no aparece en los chunks o en la metadata (published_date/effective_date/source_url/gazette_ref). Si no está, di "no consta en el material recuperado". No inventes artículos ni procedimientos.${RAG_RESPONSE_STRUCTURE}\nResponde basándote SOLO en este contexto y con la estructura anterior.`
      : "";

    console.log("[chat] rawMode=", rawMode, "modeNorm=", modeNorm, "isMax=", isMax);
    console.log("[chat] RAG chunks=", chunks.length, "ragError=", ragError?.message ?? null);

    // ————— Modo Máxima Confiabilidad (anti-alucinación) —————
    if (isMax) {
      const supabase = getSupabaseServer();
      const retrievedChunks = chunks;

      // CAPA 1: Sin chunks — NEED_MORE_INFO con 3–4 preguntas clave (máx 4)
      if (retrievedChunks.length === 0) {
        const keyQuestions = [
          "¿La exigencia está por escrito (circular/correo) o solo verbal?",
          "¿Te han indicado alguna consecuencia o sanción si no reportas?",
          "¿Esto ocurre en días libres, vacaciones o ambas?",
          "¿Tienes documentación (contrato, comunicaciones) que pueda ser relevante?",
        ].slice(0, 4);
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
        await enqueueForEnrichment(message, "max-reliability");
        return NextResponse.json(
          { type: "answer", content: DISCLAIMER_PREFIX + MESSAGE_ENRICHMENT_PENDING } satisfies ChatResponse,
          { status: 200 }
        );
      }

      const MR_TOP_K = 5;
      const MR_MAX_CTX_CHARS = 7500;
      const mrChunks = retrievedChunks.slice(0, MR_TOP_K);
      const { contextText, allChunkText } = formatMaxReliabilityContext(mrChunks, MR_MAX_CTX_CHARS);
      const allowedSourceUrls = new Set(mrChunks.map((c) => (c.citation.source_url ?? "").trim()).filter(Boolean));

      // CAPA 2: Prompt restrictivo — salida JSON estricta + estructura práctica y compacta
      const maxReliabilitySystem =
        `${DISCLAIMER_HARD_RULES}\n` +
        `Usa SOLO el CONTEXTO OFICIAL VERIFICADO. Cita artículos SOLO si aparecen literalmente en chunk_text. Usa las citations proporcionadas para referencias.\n\n` +
        `Si hay chunks relevantes (laboral, función pública, vacaciones, etc.) → da 2–3 pasos iniciales prácticos aunque falte info completa (ej. "Solicita por escrito la base normativa", "Conserva correos", "Consulta abogado"). No pidas reformulación obligatoria en consultas personales.\n\n` +
        `Modo MÁXIMA CONFIABILIDAD. Reglas estrictas:\n` +
        `- SOLO información presente en el CONTEXTO. PROHIBIDO inventar artículos, leyes, fechas o citas.\n` +
        `- Si el artículo NO aparece literalmente en el contexto, NO lo menciones.\n` +
        `- missing_info_questions: máximo 4 preguntas concretas (ej. "¿La exigencia está por escrito o solo verbal?"). Si hay contexto útil, da pasos aunque falte info y devuelve APPROVE con caveats si aplica.\n` +
        `El campo "answer" DEBE ser compacto: conclusión 3–4 líneas; pasos numerados 1–5; caveats y next_steps máx 5 bullets cada uno.\n` +
        `Estructura: 1) Conclusión directa (3–4 líneas). 2) Base legal (solo si está en contexto). 3) Cómo proceder (lista 1–5). 4) Si la institución no responde. 5) Riesgos o precauciones.\n` +
        `Tono profesional y práctico. Prioriza Constitución > Ley > Decreto.\n` +
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
        `missing_info_questions: máx 4. caveats y next_steps: máx 5 items cada uno. Las citations SOLO de los chunks del contexto.`;

      const maxReliabilityUser =
        `Consulta del usuario:\n${effectiveMessage}\n\n` +
        (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
        `Contexto oficial verificado (solo puedes citar esto):\n${contextText}\n\n` +
        `Responde ÚNICAMENTE con el JSON del schema anterior.` +
        `\n\nCONTEXTO OFICIAL VERIFICADO (SOLO PUEDES CITAR ESTO):\n${ragText}\n\nCitas disponibles (usa solo estas):\n${JSON.stringify(ragCitations, null, 2)}`;

      const MAX_RELIABILITY_AGENT_TIMEOUT_MS = 25000;
      const MR_MAX_TOKENS = 1600;
      console.log("[max-reliability] chunks=", mrChunks.length, "ctxChars=", contextText.length);
      console.log("[max-reliability] timeoutMs=", MAX_RELIABILITY_AGENT_TIMEOUT_MS, "max_tokens=", MR_MAX_TOKENS);

      const pipelineInput = {
        systemPrompt: maxReliabilitySystem,
        userPrompt: maxReliabilityUser,
        callModel: (system: string, user: string) =>
          withTimeout(
            (signal) =>
              callClaudeWithFallback({
                apiKey: anthropicKey,
                system,
                user,
                max_tokens: MR_MAX_TOKENS,
                temperature: 0,
                signal,
              }),
            MAX_RELIABILITY_AGENT_TIMEOUT_MS,
            "max-reliability"
          ),
        chunks: mrChunks,
        contextText,
        allChunkText,
        allowedSourceUrls,
        ragCitations,
        disclaimerPrefix: DISCLAIMER_PREFIX,
        maxReliabilityDisclaimer: MAX_RELIABILITY_DISCLAIMER,
      };

      let result: MaxReliabilityPipelineResult;
      try {
        result = await runMaxReliabilityPipeline(pipelineInput);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[max-reliability] Modelo falló:", errMsg);
        const isTimeout = /timeout|abort/i.test(errMsg);
        if (isTimeout) {
          const shortCtx = contextText.slice(0, 4000);
          const shortUser =
            `Consulta del usuario:\n${effectiveMessage}\n\n` +
            `CONTEXTO (recortado):\n${shortCtx}\n\nResponde ÚNICAMENTE con el JSON del schema (decision, confidence, answer, missing_info_questions, caveats, next_steps, citations).`;
          try {
            const modelRawRetry = await withTimeout(
              (signal) =>
                callClaudeWithFallback({
                  apiKey: anthropicKey,
                  system: maxReliabilitySystem,
                  user: shortUser,
                  max_tokens: 1200,
                  temperature: 0,
                  signal,
                }),
              15000,
              "max-reliability-retry"
            );
            result = await runMaxReliabilityPipeline({
              ...pipelineInput,
              userPrompt: shortUser,
              initialModelRaw: modelRawRetry,
            });
          } catch (retryErr) {
            const openaiKey = process.env.OPENAI_API_KEY;
            if (openaiKey) {
              try {
                const modelRawOpenAI = await callOpenAIStyle({
                  provider: "OpenAI-fallback",
                  url: OPENAI_URL,
                  apiKey: openaiKey,
                  model: MODELS.openai_fallback,
                  system: maxReliabilitySystem,
                  user: shortUser,
                  max_tokens: 1200,
                  temperature: 0,
                });
                result = await runMaxReliabilityPipeline({
                  ...pipelineInput,
                  userPrompt: shortUser,
                  initialModelRaw: modelRawOpenAI,
                });
              } catch (openaiErr) {
                console.error("[max-reliability] fallback OpenAI falló:", openaiErr);
                throw retryErr;
              }
            } else {
              throw retryErr;
            }
          }
        } else {
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
      }

      if (result.exit === "clarify") {
        return NextResponse.json(
          { type: "clarify", questions: result.questions } satisfies ChatResponse,
          { status: 200 }
        );
      }
      if (result.exit === "enrichment") {
        await enqueueForEnrichment(message, "max-reliability");
        return NextResponse.json(
          { type: "answer", content: DISCLAIMER_PREFIX + MESSAGE_ENRICHMENT_PENDING } satisfies ChatResponse,
          { status: 200 }
        );
      }

      const payload = result.payload;
      const maxSources = mrChunks.length > 0 ? buildSourcesFromChunks(mrChunks) : undefined;
      const payloadWithSources = maxSources ? { ...payload, sources: maxSources } : payload;
      try {
        if (supabase) {
          await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } }).from("legal_audit_log").insert({
            user_id: body.userId ?? null,
            mode: "max-reliability",
            query: message,
            decision: payload.decision,
            confidence: payload.confidence,
            citations: payload.citations,
            model_used: { judge: "claude" },
            tokens_in: null,
            tokens_out: null,
          });
        }
      } catch {
        // no bloquear respuesta por fallo de log
      }
      return NextResponse.json(payloadWithSources, { status: 200 });
    }

    // Modo normal sin chunks: encolar para auto-enriquecimiento y pedir volver en 5-10 min
    if (chunks.length === 0) {
      await enqueueForEnrichment(message, "normal");
      return NextResponse.json(
        { type: "answer", content: DISCLAIMER_PREFIX + MESSAGE_ENRICHMENT_PENDING, note: undefined } satisfies ChatResponse,
        { status: 200 }
      );
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
      `Tema/pregunta (general): ${effectiveMessage}\n\n` +
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

    // D) Síntesis final con Claude (juez) — Modo "Normal Seguro" — Estructura práctica y compacta
    const judgeSystem =
      `${DISCLAIMER_HARD_RULES}\n` +
      `Usa SOLO el "Contexto oficial verificado". No cites artículos que no aparezcan en ese contexto.\n\n` +
      `Eres el juez/sintetizador final. Respuesta compacta: conclusión 3–4 líneas; pasos numerados 1–5; caveats/next_steps máx 5 bullets cada uno. No pidas reformulación obligatoria.\n` +
      `PROHIBIDO: asesoría personalizada, instrucciones para evadir la ley, pedir datos personales.\n\n` +
      `REGLA ANTI-ALUCINACIÓN: NUNCA cites números de artículo ni plazos exactos a menos que aparezcan textualmente en el "Contexto oficial verificado" o en "Búsqueda fuentes RD" o en las respuestas de los agentes. Si no está verificado, escribe en términos generales o indica "consulte la Gaceta Oficial". No inventes artículos ni procedimientos.\n\n` +
      `Estructura OBLIGATORIA:\n${RAG_RESPONSE_STRUCTURE}\n` +
      `Al final, añade en negrita la advertencia:\n**\"${ADVERTENCIA_FINAL_EXACTA}\"**\n\n` +
      `Tono profesional, firme y práctico. Prioriza Constitución > Ley > Decreto.`;

    const judgeUser =
      `Consulta (general):\n${effectiveMessage}\n\n` +
      (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
      `Resultados de agentes y búsqueda (pueden contener errores; verifica citas con el contexto oficial o "Búsqueda fuentes RD" si está disponible y sintetiza):\n\n` +
      results
        .map((r) =>
          r.ok
            ? `=== ${r.agent} (OK) ===\n${truncate(r.content, 4000)}\n`
            : `=== ${r.agent} (FALLÓ) ===\nError: ${r.error}\n`
        )
        .join("\n") +
      `\n\nContexto oficial verificado (solo puedes citar esto):\n${ragText || "(No hay fuentes vigentes cargadas)"}`;

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
        `${DISCLAIMER_HARD_RULES}\nSintetiza en español, compacto: conclusión 3-4 líneas; pasos numerados 1-5; base legal solo si está en los datos. No inventes artículos. Tono profesional y práctico. Advertencia final: "${ADVERTENCIA_FINAL_EXACTA}".`;
      const fallbackUser = `Consulta: ${effectiveMessage}\n\nDatos disponibles:\n${results.filter((r) => r.ok).map((r) => `${r.agent}:\n${truncate(r.content, 3000)}`).join("\n\n")}`;
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

    if (ragCitations.length > 0) {
      const fuentesLines = ragCitations.map(
        (c) => `- ${c.title} | ${c.published_date ?? ""} | ${c.status} | ${c.source_url}`
      );
      final += `\n\n---\n**Fuentes verificadas:**\n${fuentesLines.join("\n")}`;
    } else {
      final += "\n\n**Nota:** No encontré fuentes vigentes para citar artículos específicos.";
    }
    final = DISCLAIMER_PREFIX + final;

    console.log("Resumen final: Total agentes contribuyentes: " + successCount + "/5");
    const sources = chunks.length > 0 ? buildSourcesFromChunks(chunks) : undefined;
    return NextResponse.json({ type: "answer", content: final, note, sources } satisfies ChatResponse, { status: 200 });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error);
    return NextResponse.json({ type: "reject", message: error.message || "Error en el orquestador" } satisfies ChatResponse, {
      status: 500,
    });
  }
}
