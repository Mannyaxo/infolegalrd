/**
 * Legal Reliability Engine v1 — Judge gate.
 * Evalúa borrador de respuesta legal y devuelve decisión estructurada (APPROVE | REWRITE | NEED_MORE_INFO | HIGH_AMBIGUITY).
 */
import type { ConstitutionCitation } from "@/lib/rag/constitution";

export type JudgeDecision =
  | "APPROVE"
  | "REWRITE"
  | "NEED_MORE_INFO"
  | "HIGH_AMBIGUITY";

export type JudgeResult = {
  decision: JudgeDecision;
  missing_info_questions: string[];
  risk_flags: string[];
  final_answer: string;
  confidence: number;
  caveats: string[];
  next_steps: string[];
  audit_summary: string;
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type EvaluateLegalAnswerParams = {
  user_query: string;
  draft_answer: string;
  citations: ConstitutionCitation[];
  mode: "standard" | "max-reliability";
  anthropicApiKey: string;
};

/**
 * Evalúa la respuesta legal con un LLM (Claude) como juez.
 * Reglas: sin citas en consulta legal => NEED_MORE_INFO o REWRITE; artículos sin cita => risk_flag + REWRITE; depende de hechos del usuario => NEED_MORE_INFO.
 */
export async function evaluateLegalAnswer(
  params: EvaluateLegalAnswerParams
): Promise<JudgeResult> {
  const { user_query, draft_answer, citations, anthropicApiKey } = params;

  const hasCitations = citations.length > 0;
  const citationBlock = hasCitations
    ? citations
        .map(
          (c) =>
            `- ${c.instrument} (${c.canonical_key}), publicada ${c.published_date}, fuente: ${c.source_url}`
        )
        .join("\n")
    : "(No se proporcionaron fuentes oficiales verificables)";

  const system = `Eres un juez de confiabilidad legal para respuestas informativas (República Dominicana). Tu salida DEBE ser ÚNICAMENTE un JSON válido, sin texto antes ni después.

Schema exacto:
{
  "decision": "APPROVE" | "REWRITE" | "NEED_MORE_INFO" | "HIGH_AMBIGUITY",
  "missing_info_questions": ["pregunta1", ...],
  "risk_flags": ["riesgo1", ...],
  "final_answer": "texto de la respuesta final para el usuario",
  "confidence": número entre 0 y 1,
  "caveats": ["salvedad1", ...],
  "next_steps": ["paso1", ...],
  "audit_summary": "resumen breve del proceso de revisión"
}

Reglas obligatorias:
- Si NO hay citas/fuentes oficiales y la consulta es de tipo legal: decision debe ser NEED_MORE_INFO o REWRITE; en final_answer incluir que no se pueden citar fuentes oficiales en este momento.
- Si el borrador afirma artículos o normas específicas sin que exista una cita correspondiente: añadir risk_flag y considerar REWRITE.
- Si la pregunta depende de hechos concretos del usuario (empleado de carrera, fechas, notificación, etc.): decision = NEED_MORE_INFO y llenar missing_info_questions (3-5).
- confidence debe ser 0-1; si no hay fuentes verificables, confidence debe ser bajo (< 0.65).
- APPROVE solo si la respuesta es sólida, tiene fuentes cuando corresponde y no inventa artículos.`;

  const user = `Consulta del usuario:\n${user_query}\n\nBorrador de respuesta a revisar:\n${draft_answer}\n\nFuentes proporcionadas (contexto oficial):\n${citationBlock}\n\nDevuelve SOLO el JSON con decision, missing_info_questions, risk_flags, final_answer, confidence, caveats, next_steps, audit_summary.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Judge API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const raw =
    (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;
  let result: Partial<JudgeResult>;
  try {
    result = JSON.parse(jsonStr) as Partial<JudgeResult>;
  } catch {
    return {
      decision: "REWRITE",
      missing_info_questions: [],
      risk_flags: ["No se pudo parsear la decisión del juez"],
      final_answer: draft_answer,
      confidence: 0.5,
      caveats: [],
      next_steps: [],
      audit_summary: "Error parseando respuesta del juez",
    };
  }

  return {
    decision: (result.decision as JudgeDecision) ?? "REWRITE",
    missing_info_questions: Array.isArray(result.missing_info_questions)
      ? result.missing_info_questions.filter((q) => typeof q === "string")
      : [],
    risk_flags: Array.isArray(result.risk_flags)
      ? result.risk_flags.filter((r) => typeof r === "string")
      : [],
    final_answer: typeof result.final_answer === "string" ? result.final_answer : draft_answer,
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    caveats: Array.isArray(result.caveats) ? result.caveats.filter((c) => typeof c === "string") : [],
    next_steps: Array.isArray(result.next_steps) ? result.next_steps.filter((s) => typeof s === "string") : [],
    audit_summary: typeof result.audit_summary === "string" ? result.audit_summary : "",
  };
}
