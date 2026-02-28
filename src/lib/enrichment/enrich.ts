/**
 * Auto-enriquecimiento: búsqueda en fuentes oficiales (.gov.do y .gob.do) y verificación con múltiples IAs.
 * Solo dominios oficiales; sin verificación multi-IA no se ingiere.
 */

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";
/** Consultoría Jurídica es .gov.do; Gaceta Oficial es .gob.do. Aceptamos ambos (por hostname, no por final de URL). */
const OFFICIAL_DOMAIN_SUFFIXES = [".gov.do", ".gob.do"];
const MIN_CONTENT_LENGTH = 200;

function isOfficialDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAIN_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}
const MAX_TEXT_FOR_VERIFY = 12000;

export type SearchResult = {
  url: string;
  title: string;
  markdown: string;
};

/**
 * Busca en consultoria.gov.do y gacetaoficial.gob.do (solo dominios .gov.do y .gob.do).
 * Respeta rate: una búsqueda por llamada. Devuelve el primer resultado con contenido suficiente.
 */
export async function searchAndDownloadLaw(
  query: string,
  firecrawlApiKey: string
): Promise<SearchResult | null> {
  const searchQuery = `site:consultoria.gov.do OR site:gacetaoficial.gob.do ${query}`.slice(0, 200);
  const res = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: searchQuery,
      limit: 5,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firecrawl search failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    data?: Array<{ url?: string; title?: string; markdown?: string }>;
    error?: string;
  };
  if (!data.success || !Array.isArray(data.data)) return null;

  for (const d of data.data) {
    const url = (d.url ?? "").trim();
    if (!url || !isOfficialDomain(url)) continue;
    const markdown = (d.markdown ?? "").trim();
    if (markdown.length < MIN_CONTENT_LENGTH) continue;
    return {
      url,
      title: (d.title ?? "Sin título").trim(),
      markdown,
    };
  }
  return null;
}

/**
 * Igual que searchAndDownloadLaw pero devuelve hasta maxResults candidatos (para reglamentos).
 */
export async function searchAndDownloadLawCandidates(
  query: string,
  firecrawlApiKey: string,
  maxResults: number = 5
): Promise<SearchResult[]> {
  const searchQuery = `site:consultoria.gov.do OR site:gacetaoficial.gob.do ${query}`.slice(0, 200);
  const res = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: searchQuery,
      limit: Math.max(5, maxResults),
      scrapeOptions: { formats: ["markdown"] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firecrawl search failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    data?: Array<{ url?: string; title?: string; markdown?: string }>;
  };
  if (!data.success || !Array.isArray(data.data)) return [];

  const out: SearchResult[] = [];
  for (const d of data.data) {
    if (out.length >= maxResults) break;
    const url = (d.url ?? "").trim();
    if (!url || !isOfficialDomain(url)) continue;
    const markdown = (d.markdown ?? "").trim();
    if (markdown.length < MIN_CONTENT_LENGTH) continue;
    out.push({
      url,
      title: (d.title ?? "Sin título").trim(),
      markdown,
    });
  }
  return out;
}

function normalizeYesNo(text: string): "yes" | "no" | "unknown" {
  const t = text.trim().toLowerCase().slice(0, 50);
  if (/^\s*yes\s*$/i.test(t) || /^\s*si\s*$/i.test(t) || /sí\s*$/i.test(t)) return "yes";
  if (/^\s*no\s*$/i.test(t)) return "no";
  return "unknown";
}

/**
 * Verificación solo con OpenAI (GPT-4o-mini). verified = true si OpenAI responde YES.
 */
export async function verifyWithMultipleAIs(
  text: string,
  title: string,
  userQuery: string,
  options: {
    anthropicApiKey?: string | null;
    groqApiKey?: string | null;
    xaiApiKey?: string | null;
    openaiApiKey?: string | null;
  }
): Promise<{ verified: boolean; votes: number; total: number; details: string[] }> {
  const excerpt = text.slice(0, MAX_TEXT_FOR_VERIFY);
  const lawMatch = userQuery.match(/ley\s*(\d{2,3}-\d{2})/i);
  const lawLine = lawMatch ? `El usuario preguntó específicamente por la Ley ${lawMatch[1]}.` : `Consulta del usuario: ${userQuery.slice(0, 200)}`;
  const prompt = `El siguiente texto es un fragmento de normativa de República Dominicana.
Título del documento: ${title}
${lawLine}

Fragmento del texto:
---
${excerpt}
---

¿Este documento ES o CONTIENE la norma que el usuario busca y está vigente (no derogada)? Responde ÚNICAMENTE "YES" o "NO".`;

  const details: string[] = [];
  let yesCount = 0;
  let total = 0;

  if (options.openaiApiKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.openaiApiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 10,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const answer = j.choices?.[0]?.message?.content ?? "";
        total++;
        const v = normalizeYesNo(answer);
        if (v === "yes") yesCount++;
        details.push(`OpenAI: ${v}`);
      }
    } catch (e) {
      details.push(`OpenAI: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const verified = total >= 1 && yesCount >= 1;
  return { verified, votes: yesCount, total, details };
}
