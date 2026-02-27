/**
 * Auto-enriquecimiento: búsqueda en fuentes oficiales (.gob.do) y verificación con múltiples IAs.
 * Solo dominios oficiales; sin verificación multi-IA no se ingiere.
 */

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";
const OFFICIAL_DOMAIN_SUFFIX = ".gob.do";
const MIN_CONTENT_LENGTH = 200;
const MAX_TEXT_FOR_VERIFY = 12000;

export type SearchResult = {
  url: string;
  title: string;
  markdown: string;
};

/**
 * Busca en consultoria.gov.do y gacetaoficial.gob.do (solo dominios .gob.do).
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
    if (!url || !url.toLowerCase().endsWith(OFFICIAL_DOMAIN_SUFFIX)) continue;
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

function normalizeYesNo(text: string): "yes" | "no" | "unknown" {
  const t = text.trim().toLowerCase().slice(0, 50);
  if (/^\s*yes\s*$/i.test(t) || /^\s*si\s*$/i.test(t) || /sí\s*$/i.test(t)) return "yes";
  if (/^\s*no\s*$/i.test(t)) return "no";
  return "unknown";
}

/**
 * Verifica con Claude, Grok y GPT-4o-mini que el texto corresponda a la norma correcta y versión vigente.
 * Si al menos 2 de 3 confirman (YES) → verified: true.
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
  const prompt = `El siguiente texto es un fragmento de normativa de República Dominicana.
Título del documento: ${title}
Consulta del usuario que motivó la búsqueda: ${userQuery.slice(0, 300)}

Fragmento del texto:
---
${excerpt}
---

¿Este texto corresponde a la norma correcta y a una versión vigente (no derogada) que es relevante para la consulta? Responde ÚNICAMENTE "YES" o "NO".`;

  const details: string[] = [];
  let yesCount = 0;
  let total = 0;

  // Claude
  if (options.anthropicApiKey) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 10,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as { content?: Array<{ text?: string }> };
        const answer = j.content?.[0]?.text ?? "";
        total++;
        const v = normalizeYesNo(answer);
        if (v === "yes") yesCount++;
        details.push(`Claude: ${v}`);
      }
    } catch (e) {
      details.push(`Claude: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Groq (OpenAI-compatible)
  if (options.groqApiKey) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.groqApiKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
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
        details.push(`Groq: ${v}`);
      }
    } catch (e) {
      details.push(`Groq: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // OpenAI GPT-4o-mini
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

  // XAI Grok como respaldo si no hay Groq
  if (total < 2 && options.xaiApiKey) {
    try {
      const r = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.xaiApiKey}` },
        body: JSON.stringify({
          model: "grok-2-1212",
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
        details.push(`xAI: ${v}`);
      }
    } catch (e) {
      details.push(`xAI: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const verified = total >= 2 && yesCount >= 2;
  return { verified, votes: yesCount, total, details };
}
