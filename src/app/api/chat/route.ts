import { NextRequest, NextResponse } from "next/server";
import { DISCLAIMER_PREFIX } from "@/lib/chat-guardrails";

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

const BUSQUEDA_PROMPT = (tema: string) =>
  `Busca y cita textualmente leyes, reglamentos, Constitución RD, jurisprudencia SCJ/TC con números y fechas, doctrina y actualizaciones 2026 relevantes a ${tema}. Prioriza fuentes oficiales: scj.gob.do, tc.gob.do, gacetaoficial.gob.do, mt.gob.do, map.gob.do.
CRÍTICO: NUNCA inventes o resumas el contenido de un artículo de ley por tu cuenta. Si no tienes el texto literal del artículo frente a ti, escribe "El contenido exacto del artículo [X] debe verificarse en la Gaceta Oficial o en el texto oficial de la ley" en lugar de redactar un resumen. Los números de artículos y su contenido real no siempre coinciden entre leyes; atribuir contenido a un artículo sin verificación genera errores graves. Si no puedes verificar una cita textual, indícalo explícitamente y no inventes números ni fechas.`;

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

/** Extrae JSON de texto que puede venir envuelto en ```json ... ``` */
function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(trimmed);
  const toParse = codeBlock ? codeBlock[1].trim() : trimmed;
  return safeJsonParse<T>(toParse);
}

type JudgeDecision = "APPROVE" | "REWRITE" | "NEED_MORE_INFO" | "HIGH_AMBIGUITY";
type JudgePayload = {
  decision?: JudgeDecision;
  missing_info_questions?: string[];
  risk_flags?: string[];
  final_answer?: string;
  confidence?: number;
  caveats?: string[];
  next_steps?: string[];
  audit_summary?: string;
};

const MAX_RELIABILITY_DISCLAIMER =
  "Modo experimental de máxima confiabilidad. Respuesta revisada por juez, pero sigue siendo información general, no asesoría legal.";

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

    // ————— Modo Máxima Confiabilidad (experimental) —————
    if (mode === "max-reliability") {
      const advocateSystem =
        `${DISCLAIMER_HARD_RULES}\n` +
        `Genera un borrador inicial (draft) de respuesta informativa sobre derecho en República Dominicana. Sé estructurado y prudente. No des asesoría personalizada. El borrador NO es la respuesta final; será revisado por un juez.`;
      const advocateUser =
        `Consulta (general):\n${message}\n\n` +
        (historyText ? `Contexto previo:\n${historyText}\n\n` : "") +
        `Redacta un borrador informativo y general.`;

      let draft: string;
      try {
        draft = await callClaudeWithFallback({
          apiKey: anthropicKey,
          system: advocateSystem,
          user: advocateUser,
          max_tokens: 4096,
          temperature: 0.2,
        });
      } catch (e) {
        console.error("[max-reliability] Advocate falló:", e instanceof Error ? e.message : String(e));
        return NextResponse.json(
          { type: "reject", message: "No se pudo generar el borrador en modo máxima confiabilidad." } satisfies ChatResponse,
          { status: 503 }
        );
      }

      const judgeSystem =
        `Eres un juez estricto que revisa borradores de respuestas jurídicas informativas (República Dominicana). Tu salida DEBE ser ÚNICAMENTE un JSON válido, sin texto antes ni después.
Schema exacto:
{
  "decision": "APPROVE" | "REWRITE" | "NEED_MORE_INFO" | "HIGH_AMBIGUITY",
  "missing_info_questions": ["pregunta1", "pregunta2", ...],
  "risk_flags": ["riesgo1", ...],
  "final_answer": "texto de la respuesta final para el usuario",
  "confidence": número entre 0 y 1,
  "caveats": ["salvedad1", ...],
  "next_steps": ["paso1", ...],
  "audit_summary": "resumen breve del proceso de revisión"
}
Reglas:
- Si faltan hechos esenciales para dar una respuesta segura → decision = "NEED_MORE_INFO". En ese caso final_answer DEBE contener SOLO: (1) Un párrafo explicativo breve (máximo 6 líneas), (2) Exactamente 5 preguntas (las más críticas para el caso), (3) Un aviso corto sobre plazos/deadlines sin dar números exactos salvo que se conozca fecha de notificación y foro. NO incluyas en final_answer listas largas de riesgos ni salvedades (esas van en risk_flags/caveats para uso interno).
- Si confidence < 0.65 → forzar decision = "NEED_MORE_INFO".
- Si hay contradicción, ambigüedad alta o dos interpretaciones razonables → decision = "HIGH_AMBIGUITY".
- APPROVE solo si la respuesta es sólida y verificable; REWRITE si el juez puede mejorar el texto y lo hace en final_answer.`;

      let judgeUser =
        `Pregunta del usuario:\n${message}\n\n` +
        (historyText ? `Contexto:\n${historyText}\n\n` : "") +
        `Borrador a revisar:\n${truncate(draft, 6000)}\n\n` +
        `Devuelve SOLO el JSON con decision, missing_info_questions, risk_flags, final_answer, confidence, caveats, next_steps, audit_summary.`;

      let judgeRaw: string;
      try {
        judgeRaw = await callClaudeWithFallback({
          apiKey: anthropicKey,
          system: judgeSystem,
          user: judgeUser,
          max_tokens: 4096,
          temperature: 0.1,
        });
      } catch (e) {
        console.error("[max-reliability] Judge falló:", e instanceof Error ? e.message : String(e));
        return NextResponse.json(
          { type: "reject", message: "No se pudo completar la revisión en modo máxima confiabilidad." } satisfies ChatResponse,
          { status: 503 }
        );
      }

      let judge = extractJson<JudgePayload>(judgeRaw);
      if (!judge) judge = safeJsonParse<JudgePayload>(judgeRaw) || {};

      let decision = (judge.decision ?? "REWRITE") as JudgeDecision;
      let finalAnswer = typeof judge.final_answer === "string" ? judge.final_answer : draft;
      let confidence = typeof judge.confidence === "number" ? judge.confidence : 0.5;
      let missingInfo = Array.isArray(judge.missing_info_questions)
        ? judge.missing_info_questions.filter((q) => typeof q === "string")
        : [];
      let riskFlags = Array.isArray(judge.risk_flags) ? judge.risk_flags.filter((r) => typeof r === "string") : [];
      let caveats = Array.isArray(judge.caveats) ? judge.caveats.filter((c) => typeof c === "string") : [];
      let nextSteps = Array.isArray(judge.next_steps) ? judge.next_steps.filter((s) => typeof s === "string") : [];
      let auditSummary = typeof judge.audit_summary === "string" ? judge.audit_summary : "";

      if (confidence < 0.65 && decision !== "NEED_MORE_INFO") {
        decision = "NEED_MORE_INFO";
        if (missingInfo.length === 0) {
          missingInfo.push("¿Puede precisar los hechos principales de su escenario?");
          missingInfo.push("¿Hay plazos o fechas relevantes?");
          missingInfo.push("¿Existe documentación (contrato, notificación) que deba considerarse?");
        }
      }

      // NEED_MORE_INFO: exactly 5 questions for UX; user-visible answer = paragraph + questions + short deadline warning only
      if (decision === "NEED_MORE_INFO") {
        const fiveQuestions = missingInfo.slice(0, 5);
        while (fiveQuestions.length < 5) {
          fiveQuestions.push("¿Hay algún otro hecho relevante que debamos considerar?");
        }
        missingInfo = fiveQuestions;
        const deadlineWarning =
          "Tenga en cuenta que en materia legal suelen existir plazos; consulte con un abogado para conocer los que apliquen a su situación una vez tenga la información concreta.";
        const paragraphMatch = finalAnswer.split(/\n\n+/)[0];
        const shortParagraph = paragraphMatch ? paragraphMatch.replace(/\n/g, " ").trim().slice(0, 600) : "Para orientarle con más precisión necesitamos aclarar algunos puntos.";
        finalAnswer =
          shortParagraph +
          "\n\n**Preguntas esenciales:**\n" +
          fiveQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
          "\n\n" +
          deadlineWarning;
      }

      // Paso C: HIGH_AMBIGUITY → contra-argumento y segundo juicio
      if (decision === "HIGH_AMBIGUITY") {
        const counterSystem =
          `${DISCLAIMER_HARD_RULES}\n` +
          `Genera un contra-argumento o perspectiva alternativa al siguiente borrador jurídico. Objetivo: que un juez pueda contrastar ambas visiones. No des asesoría personalizada.`;
        const counterUser = `Consulta: ${message}\n\nBorrador actual:\n${truncate(draft, 4000)}\n\nRedacta el contra-argumento o interpretación alternativa (máximo 1.500 caracteres).`;

        let counterArgument = "";
        if (geminiKey) {
          try {
            counterArgument = await callGeminiWithFallback({
              apiKey: geminiKey,
              user: `${counterSystem}\n\n${counterUser}`,
              temperature: 0.3,
              maxOutputTokens: 800,
            });
          } catch {
            // seguir sin contra-argumento
          }
        }
        if (!counterArgument && openaiKey) {
          try {
            counterArgument = await callOpenAIStyle({
              provider: "OpenAI",
              url: OPENAI_URL,
              apiKey: openaiKey,
              model: MODELS.openai_primary,
              system: counterSystem,
              user: counterUser,
              max_tokens: 800,
              temperature: 0.3,
            });
          } catch {
            // seguir sin contra-argumento
          }
        }
        if (!counterArgument && groqKey) {
          try {
            counterArgument = await callOpenAIStyle({
              provider: "Groq",
              url: GROQ_URL,
              apiKey: groqKey,
              model: MODELS.groq,
              system: counterSystem,
              user: counterUser,
              max_tokens: 800,
              temperature: 0.3,
            });
          } catch {
            // seguir sin contra-argumento
          }
        }

        if (counterArgument) {
          const secondJudgeUser =
            `Pregunta:\n${message}\n\nBorrador original:\n${truncate(draft, 3000)}\n\nContra-argumento:\n${truncate(counterArgument, 2000)}\n\n` +
            `Considerando ambas posturas, devuelve SOLO un JSON con: decision (APPROVE, REWRITE o NEED_MORE_INFO), final_answer, confidence, caveats, next_steps, risk_flags, audit_summary, missing_info_questions.`;
          try {
            const secondJudgeRaw = await callClaudeWithFallback({
              apiKey: anthropicKey,
              system: judgeSystem,
              user: secondJudgeUser,
              max_tokens: 4096,
              temperature: 0.1,
            });
            const secondJudge = extractJson<JudgePayload>(secondJudgeRaw) || safeJsonParse<JudgePayload>(secondJudgeRaw);
            if (secondJudge) {
              decision = (secondJudge.decision ?? decision) as JudgeDecision;
              if (typeof secondJudge.final_answer === "string") finalAnswer = secondJudge.final_answer;
              if (typeof secondJudge.confidence === "number") confidence = secondJudge.confidence;
              if (Array.isArray(secondJudge.missing_info_questions)) {
                missingInfo.length = 0;
                missingInfo.push(...secondJudge.missing_info_questions.filter((q) => typeof q === "string").slice(0, 7));
              }
              if (Array.isArray(secondJudge.risk_flags)) riskFlags = secondJudge.risk_flags.filter((r) => typeof r === "string");
              if (Array.isArray(secondJudge.caveats)) caveats = secondJudge.caveats.filter((c) => typeof c === "string");
              if (Array.isArray(secondJudge.next_steps)) nextSteps = secondJudge.next_steps.filter((s) => typeof s === "string");
              if (typeof secondJudge.audit_summary === "string") auditSummary = secondJudge.audit_summary;
            }
          } catch {
            // mantener decisión HIGH_AMBIGUITY y respuestas ya obtenidas
          }
        }
      }

      const answerWithDisclaimer = `${MAX_RELIABILITY_DISCLAIMER}\n\n${finalAnswer}`;
      const payload = {
        type: "answer" as const,
        content: DISCLAIMER_PREFIX + answerWithDisclaimer,
        mode: "max-reliability" as const,
        decision,
        answer: answerWithDisclaimer,
        questions: missingInfo,
        confidence,
        caveats,
        next_steps: nextSteps,
        risk_flags: riskFlags,
      };
      console.log(
        JSON.stringify({
          mode: "max-reliability",
          decision: payload.decision,
          confidence: payload.confidence,
          timestamp: new Date().toISOString(),
          audit_summary: auditSummary,
        })
      );
      return NextResponse.json(payload, { status: 200 });
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

    // D) Síntesis final con Claude (juez) — Modo "Normal Seguro"
    const judgeSystem =
      `${DISCLAIMER_HARD_RULES}\n` +
      `Eres el juez/sintetizador final en modo "Normal Seguro". Produce una respuesta educativa y general sobre derecho dominicano.\n` +
      `PROHIBIDO: asesoría personalizada, instrucciones para evadir la ley, pedir datos personales.\n\n` +
      `REGLA ANTI-ALUCINACIÓN (obligatoria): NUNCA cites números de artículo ni plazos exactos (días, meses) a menos que ese dato aparezca textualmente en "Búsqueda fuentes RD" o en las respuestas de los agentes. Si no está verificado en esas fuentes internas, escribe en términos generales (ej. "existen plazos legales que conviene confirmar con un abogado" o "consulte la Gaceta Oficial para el texto del artículo"). No inventes contenido de artículos ni fechas.\n\n` +
      `Estructura de tu salida (obligatoria):\n` +
      `1. **Framework general** (máximo 12 líneas): contexto breve, marco legal genérico y principios aplicables. Sin artículos ni plazos concretos salvo que estén verificados en las fuentes internas.\n` +
      `2. **Tres preguntas esenciales** que el usuario debería considerar para su situación (genéricas, sin pedir datos personales).\n` +
      `3. **Orientación adicional** (breve): recomendaciones generales y advertencia final en negrita:\n` +
      `**\"${ADVERTENCIA_FINAL_EXACTA}\"**\n\n` +
      `No incluyas bloques largos de normativa ni análisis detallado con artículos no verificados. Prioriza claridad y prudencia.`;

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
        `${DISCLAIMER_HARD_RULES}\nSintetiza en español (modo Normal Seguro): 1) Framework general (máx 12 líneas), 2) Tres preguntas esenciales para el usuario, 3) Orientación breve. No cites artículos ni plazos exactos salvo que estén en los datos. Advertencia final: "${ADVERTENCIA_FINAL_EXACTA}".`;
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
