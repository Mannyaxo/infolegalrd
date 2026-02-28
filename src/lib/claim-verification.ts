/**
 * Verificación de claims al estilo Harvey: extrae afirmaciones legales de la respuesta
 * y comprueba cada una contra el texto de los chunks (RAG). Reduce alucinaciones.
 */

const MIN_CLAIM_LENGTH = 15;
const MIN_PHRASE_WORDS = 4;
const PHRASE_WORD_LENGTH = 5;

/**
 * Extrae oraciones o frases que contienen afirmaciones legales (artículo, ley, decreto, según, establece, etc.).
 */
export function extractLegalClaims(answerText: string): string[] {
  const normalized = answerText.replace(/\r\n/g, "\n").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const legalTrigger =
    /(?:art\.?\s*\d+|artículo?s?\s*\d+|ley\s*\d{2,3}-\d{2}|decreto\s*\d{2,3}-\d{2}|según|conforme\s+a?|establece|dispone|consagra|prevé|señala)/i;
  const sentences = normalized.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const claims: string[] = [];
  for (const s of sentences) {
    if (s.length < MIN_CLAIM_LENGTH) continue;
    if (legalTrigger.test(s)) claims.push(s);
  }
  return Array.from(new Set(claims));
}

/**
 * Comprueba si una afirmación está respaldada por el texto de los chunks.
 * - Las referencias normativas (art. X, Ley Y-Y) deben aparecer en chunkText.
 * - Al menos una frase sustancial (varios palabras consecutivas) de la afirmación debe aparecer.
 */
function isClaimSupported(claim: string, chunkText: string): boolean {
  const claimNorm = claim.toLowerCase().replace(/\s+/g, " ");
  const chunkLower = chunkText.toLowerCase();

  // Referencias que deben estar en los chunks
  const artRef = claimNorm.match(/art\.?\s*\d+|artículo?s?\s*\d+/gi);
  const leyRef = claimNorm.match(/ley\s*\d{2,3}-\d{2}/gi);
  const decRef = claimNorm.match(/decreto\s*\d{2,3}-\d{2}/gi);
  const refs = [...(artRef ?? []), ...(leyRef ?? []), ...(decRef ?? [])];
  for (const r of refs) {
    if (!chunkLower.includes(r.replace(/\s+/g, " "))) return false;
  }

  // Si hay referencias normativas y todas están en chunks, considerar verificado
  if (refs.length > 0) return true;

  // Si no hay referencias, exigir que alguna frase sustancial coincida
  const words = claimNorm.split(/\s+/).filter((w) => w.length > 1);
  for (let i = 0; i <= words.length - MIN_PHRASE_WORDS; i++) {
    const phrase = words.slice(i, i + PHRASE_WORD_LENGTH).join(" ");
    if (phrase.length >= 12 && chunkLower.includes(phrase)) return true;
  }
  if (words.length >= MIN_PHRASE_WORDS) {
    const phrase = words.slice(0, MIN_PHRASE_WORDS).join(" ");
    if (chunkLower.includes(phrase)) return true;
  }
  return false;
}

/**
 * Verifica cada claim contra el texto concatenado de los chunks.
 * Devuelve listas de claims verificados y no verificados.
 */
export function verifyClaimsAgainstChunks(
  claims: string[],
  allChunkText: string
): { verified: string[]; unverified: string[] } {
  if (claims.length === 0) return { verified: [], unverified: [] };
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const c of claims) {
    if (isClaimSupported(c, allChunkText)) verified.push(c);
    else unverified.push(c);
  }
  return { verified, unverified };
}

/**
 * Pipeline Harvey-style: extrae claims de la respuesta y verifica contra el RAG.
 * Devuelve caveat para los no verificados (vacío si todos pasan).
 */
export function verifyAnswerClaims(answerText: string, allChunkText: string): {
  unverifiedClaims: string[];
  caveat: string;
} {
  const claims = extractLegalClaims(answerText);
  const { unverified } = verifyClaimsAgainstChunks(claims, allChunkText);
  const caveat =
    unverified.length > 0
      ? "Afirmaciones no verificadas en las fuentes cargadas: " +
        unverified.slice(0, 5).map((c) => `"${c.slice(0, 80)}${c.length > 80 ? "…" : ""}"`).join("; ")
      : "";
  return { unverifiedClaims: unverified, caveat };
}

// --- Post-check: artículos no verificados (eliminar de la respuesta y añadir caveat) ---

function extractArticleMentions(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [/art\.?\s*\d+/gi, /artículo?s?\s*\d+/gi];
  const out: string[] = [];
  for (const re of patterns) {
    const matches = Array.from(normalized.matchAll(re));
    for (const m of matches) {
      out.push(m[0].toLowerCase().replace(/\s+/g, " "));
    }
  }
  return Array.from(new Set(out));
}

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
export function stripUnverifiedArticlesAndAddCaveat(answerText: string, allChunkText: string): {
  cleaned: string;
  caveat: string;
} {
  const unverified = getUnverifiedArticleMentions(answerText, allChunkText);
  if (unverified.length === 0) return { cleaned: answerText, caveat: "" };
  const caveat =
    "No verificado en fuentes cargadas: " + unverified.join(", ") + ".";
  const unverifiedLower = unverified.map((u) => u.toLowerCase());
  const sentences = answerText.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const low = s.toLowerCase();
    return !unverifiedLower.some((u) => low.includes(u));
  });
  const cleaned = kept.join(" ").replace(/\s+/g, " ").trim();
  return { cleaned, caveat };
}
