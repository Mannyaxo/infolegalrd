/**
 * Pipeline agentic de máxima confiabilidad (Fase 1).
 * Orquesta: Researcher → Judge → Claim verification → Payload.
 */
import type { VigenteChunk } from "@/lib/rag/vigente";
import { stripUnverifiedArticlesAndAddCaveat, verifyAnswerClaims } from "@/lib/claim-verification";

export type MaxReliabilityCitation = {
  instrument: string;
  type: string;
  number: string | null;
  published_date: string;
  status: string;
  source_url: string;
  chunk_index: number;
};

export type MaxReliabilityPayload = {
  decision: "APPROVE" | "NEED_MORE_INFO" | "NO_EVIDENCE" | "UNVERIFIED_CITATION";
  confidence: number;
  answer: string;
  missing_info_questions?: string[];
  caveats?: string[];
  next_steps?: string[];
  citations?: MaxReliabilityCitation[];
};

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(trimmed);
  const toParse = codeBlock ? codeBlock[1].trim() : trimmed;
  return safeJsonParse<T>(toParse);
}

export type ResearcherInput = {
  systemPrompt: string;
  userPrompt: string;
  callModel: (system: string, user: string) => Promise<string>;
};

/** Paso 1: Researcher — llama al modelo con system + user y devuelve el raw. */
export async function runResearcherStep(input: ResearcherInput): Promise<string> {
  return input.callModel(input.systemPrompt, input.userPrompt);
}

export type JudgeInput = {
  allowedSourceUrls: Set<string>;
};

export type JudgeResult = {
  exit?: "clarify" | "enrichment";
  decision: "APPROVE" | "NEED_MORE_INFO" | "NO_EVIDENCE" | "UNVERIFIED_CITATION";
  confidence: number;
  answer: string;
  missingInfo: string[];
  caveats: string[];
  nextSteps: string[];
  citations: MaxReliabilityCitation[];
};

/** Paso 2: Judge — parsea JSON, filtra citations, detecta salidas tempranas. */
export function runJudgeStep(modelRaw: string, input: JudgeInput): JudgeResult {
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

  const decision =
    parsed.decision === "APPROVE" ||
    parsed.decision === "NEED_MORE_INFO" ||
    parsed.decision === "NO_EVIDENCE" ||
    parsed.decision === "UNVERIFIED_CITATION"
      ? parsed.decision
      : "NO_EVIDENCE";
  const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
  let answer = typeof parsed.answer === "string" ? parsed.answer : "";
  const missingInfo = Array.isArray(parsed.missing_info_questions)
    ? parsed.missing_info_questions.filter((q) => typeof q === "string").slice(0, 4)
    : [];
  let caveats = Array.isArray(parsed.caveats) ? parsed.caveats.filter((c) => typeof c === "string").slice(0, 5) : [];
  const nextSteps = Array.isArray(parsed.next_steps) ? parsed.next_steps.filter((s) => typeof s === "string").slice(0, 5) : [];
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

  citations = citations.filter((c) => input.allowedSourceUrls.has((c.source_url ?? "").trim()));

  const result: JudgeResult = {
    decision,
    confidence,
    answer,
    missingInfo,
    caveats,
    nextSteps,
    citations,
  };

  if (decision === "NEED_MORE_INFO") {
    result.exit = "clarify";
    return result;
  }
  if (decision === "NO_EVIDENCE" || confidence < 0.5) {
    result.exit = "enrichment";
    return result;
  }

  return result;
}

export type ClaimVerificationInput = {
  stripUnverified: (answer: string, allChunkText: string) => { cleaned: string; caveat: string };
  verifyClaims: (answer: string, allChunkText: string) => { caveat: string };
};

export type ClaimVerificationResult = {
  answer: string;
  decision: "APPROVE" | "UNVERIFIED_CITATION";
  confidence: number;
  caveats: string[];
};

/** Paso 3: Claim verification — strip artículos no verificados + verifyAnswerClaims. */
export function runClaimVerificationStep(
  answer: string,
  allChunkText: string,
  current: { decision: JudgeResult["decision"]; confidence: number; caveats: string[] },
  input: ClaimVerificationInput
): ClaimVerificationResult {
  let outAnswer = answer;
  let decision = current.decision as "APPROVE" | "UNVERIFIED_CITATION";
  let confidence = current.confidence;
  const caveats = [...current.caveats];

  const { cleaned: answerCleaned, caveat: articleCaveat } = input.stripUnverified(outAnswer, allChunkText);
  if (articleCaveat) {
    decision = "UNVERIFIED_CITATION";
    confidence = 0.6;
    outAnswer = answerCleaned + "\n\n**Nota:** " + articleCaveat;
    caveats.push(articleCaveat);
  } else {
    outAnswer = answerCleaned;
  }

  const { caveat: claimCaveat } = input.verifyClaims(outAnswer, allChunkText);
  if (claimCaveat) {
    decision = "UNVERIFIED_CITATION";
    confidence = Math.min(confidence, 0.65);
    outAnswer = outAnswer + "\n\n**Nota:** " + claimCaveat;
    caveats.push(claimCaveat);
  }

  return { answer: outAnswer, decision, confidence, caveats };
}

export type MaxReliabilityPipelineInput = {
  systemPrompt: string;
  userPrompt: string;
  callModel: (system: string, user: string) => Promise<string>;
  /** Si se pasa, se omite la llamada al modelo y se usa este raw (útil para retry/fallback en la ruta). */
  initialModelRaw?: string;
  chunks: VigenteChunk[];
  contextText: string;
  allChunkText: string;
  allowedSourceUrls: Set<string>;
  ragCitations: Array<{ title?: string; source_url?: string; published_date?: string; status?: string }>;
  disclaimerPrefix: string;
  maxReliabilityDisclaimer: string;
};

export type MaxReliabilityPipelineResult =
  | { exit: "clarify"; questions: string[] }
  | { exit: "enrichment" }
  | { exit: "answer"; payload: MaxReliabilityResponsePayload };

export type MaxReliabilityResponsePayload = {
  type: "answer";
  content: string;
  mode: "max-reliability";
  ok: true;
  decision: string;
  answer: string;
  questions: string[];
  confidence: number;
  caveats: string[];
  next_steps: string[];
  citations: Array<{ title: string; source_url: string; published_date: string; status: string }>;
};

/** Orquestador: Researcher → Judge → (clarify | enrichment | Claim verification → Payload). */
export async function runMaxReliabilityPipeline(
  input: MaxReliabilityPipelineInput
): Promise<MaxReliabilityPipelineResult> {
  const modelRaw =
    input.initialModelRaw ??
    (await runResearcherStep({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      callModel: input.callModel,
    }));

  const judgeResult = runJudgeStep(modelRaw, { allowedSourceUrls: input.allowedSourceUrls });

  if (judgeResult.exit === "clarify") {
    const questions =
      judgeResult.missingInfo.length > 0
        ? judgeResult.missingInfo
        : [
            "¿La exigencia está por escrito (circular/correo) o solo verbal?",
            "¿Te han indicado sanciones si no cumples?",
            "¿Aplica en días libres, vacaciones o ambos?",
            "¿Tienes documentación (contrato, comunicaciones) que pueda ser relevante?",
          ];
    return { exit: "clarify", questions: questions.slice(0, 4) };
  }

  if (judgeResult.exit === "enrichment") {
    return { exit: "enrichment" };
  }

  const postCheck = runClaimVerificationStep(
    judgeResult.answer,
    input.allChunkText,
    { decision: judgeResult.decision, confidence: judgeResult.confidence, caveats: judgeResult.caveats },
    { stripUnverified: stripUnverifiedArticlesAndAddCaveat, verifyClaims: verifyAnswerClaims }
  );

  let answer = postCheck.answer;

  if (input.chunks.length > 0 && /no\s+encontr[eé]\s+fuentes/i.test(answer)) {
    answer = answer
      .replace(/\s*[.\s]*(no\s+encontr[eé]\s+fuentes[^.]*)[.]?\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (answer.trim().length < 80) {
    answer =
      "No se pudo generar un criterio específico con el contexto recuperado. Consulte las fuentes verificadas más abajo; si lo desea, reformule su consulta con más detalle o use el modo Normal para orientación general.";
  }

  const finalCitationsForLog = judgeResult.citations.map((c) => ({
    title: c.instrument,
    source_url: c.source_url,
    published_date: c.published_date,
    status: c.status,
  }));

  const fuentesFromChunks = (() => {
    const seen = new Set<string>();
    const out: { title: string; source_url: string; published_date: string; status: string; canonical_key?: string }[] = [];
    for (const c of input.chunks) {
      const key = `${c.citation.title ?? ""}|${c.citation.source_url ?? ""}|${c.citation.published_date ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          title: c.citation.title ?? "",
          source_url: c.citation.source_url ?? "",
          published_date: c.citation.published_date ?? "",
          status: c.citation.status ?? "VIGENTE",
          canonical_key: c.citation.canonical_key,
        });
      }
    }
    return out;
  })();

  const fuentesToShow = finalCitationsForLog.length > 0 ? finalCitationsForLog : fuentesFromChunks;

  let answerWithDisclaimer = `${input.maxReliabilityDisclaimer}\n\n${answer}`;
  if (input.ragCitations.length > 0) {
    const fuentesLines = input.ragCitations.map(
      (c) => `- ${c.title ?? ""} | ${c.published_date ?? ""} | ${c.status ?? ""} | ${c.source_url ?? ""}`
    );
    answerWithDisclaimer += `\n\n---\n**Fuentes verificadas:**\n${fuentesLines.join("\n")}`;
  } else {
    answerWithDisclaimer += "\n\n**Nota:** No encontré fuentes vigentes para citar artículos específicos.";
  }

  const citationsForPayload = (input.ragCitations.length > 0 ? input.ragCitations : fuentesToShow).map((c) => ({
    title: (c as { title?: string }).title ?? "",
    source_url: (c as { source_url?: string }).source_url ?? "",
    published_date: (c as { published_date?: string }).published_date ?? "",
    status: (c as { status?: string }).status ?? "",
  }));

  const payload: MaxReliabilityResponsePayload = {
    type: "answer",
    content: input.disclaimerPrefix + answerWithDisclaimer,
    mode: "max-reliability",
    ok: true,
    decision: postCheck.decision,
    answer: answerWithDisclaimer,
    questions: judgeResult.missingInfo,
    confidence: postCheck.confidence,
    caveats: postCheck.caveats,
    next_steps: judgeResult.nextSteps,
    citations: citationsForPayload,
  };

  return { exit: "answer", payload };
}
