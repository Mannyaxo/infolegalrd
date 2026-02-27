import "dotenv/config";
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  normalizeText,
  sha256,
  deriveCanonicalFromTitle,
  extractPublishedDate,
  ensureConsultoriaSourceId,
  upsertInstrument,
  ingestVersionAndChunks,
  type CrawlDoc,
} from "./_consultoria_pipeline";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Crawl selectivo de consultoria.gov.do con Firecrawl.
 * Env: FIRECRAWL_API_KEY, SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * Uso: npm run crawl:consultoria
 *
 * - Inicia crawl en https://www.consultoria.gov.do/consulta/ con limit=20
 * - Filtra solo URLs con ley, decreto, resolucion, constitucion
 * - Por cada documento: canonical_key, hash; si nuevo o cambió → instrument_version VIGENTE + chunks con embeddings
 */
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const CONSULTORIA_START = "https://www.consultoria.gov.do/consulta/";
const CRAWL_LIMIT = 20;
const URL_KEYWORDS = /ley|decreto|resolucion|constitucion/i;

async function startCrawl(apiKey: string): Promise<string> {
  const res = await fetch(`${FIRECRAWL_BASE}/crawl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: CONSULTORIA_START,
      limit: CRAWL_LIMIT,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firecrawl start failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { success?: boolean; id?: string };
  if (!data.id) throw new Error("Firecrawl no devolvió id de crawl");
  return data.id;
}

async function getCrawlStatus(apiKey: string, jobId: string): Promise<{ status: string; data?: CrawlDoc[] }> {
  const res = await fetch(`${FIRECRAWL_BASE}/crawl/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Firecrawl status failed: ${res.status}`);
  const data = (await res.json()) as { status: string; data?: CrawlDoc[]; next?: string };
  return { status: data.status, data: data.data };
}

async function waitForCrawl(apiKey: string, jobId: string): Promise<CrawlDoc[]> {
  const maxWait = 5 * 60 * 1000;
  const pollInterval = 8000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const { status, data } = await getCrawlStatus(apiKey, jobId);
    if (status === "completed" && data && data.length > 0) return data;
    if (status === "failed") throw new Error("Crawl job failed");
    console.log("   Crawl status:", status, data?.length ?? 0, "pages");
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  throw new Error("Crawl timeout");
}

async function main() {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!firecrawlKey) {
    console.error("Falta FIRECRAWL_API_KEY en .env.local");
    process.exit(1);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error("Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!openaiKey) {
    console.error("Falta OPENAI_API_KEY");
    process.exit(1);
  }

  console.log("1) Iniciando crawl en", CONSULTORIA_START, "limit", CRAWL_LIMIT);
  const jobId = await startCrawl(firecrawlKey);
  console.log("   Job ID:", jobId);

  console.log("2) Esperando resultados...");
  const allData = await waitForCrawl(firecrawlKey, jobId);
  const filtered = allData.filter((d) => {
    const url = (d.metadata?.sourceURL ?? d.metadata?.url ?? "").toLowerCase();
    return URL_KEYWORDS.test(url);
  });
  console.log("   Páginas filtradas (ley/decreto/resolucion/constitucion):", filtered.length);

  const supabase = createClient(supabaseUrl, serviceKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const sourceId = await ensureConsultoriaSourceId(supabase);
  if (!sourceId) {
    console.error("No se pudo crear/obtener source ConsultoriaGovDo");
    process.exit(1);
  }

  for (let idx = 0; idx < filtered.length; idx++) {
    const doc = filtered[idx];
    const url = (doc.metadata?.sourceURL ?? doc.metadata?.url ?? "") as string;
    const title = (doc.metadata?.title ?? "Sin título") as string;
    const rawMarkdown = doc.markdown ?? "";
    const contentText = normalizeText(rawMarkdown);
    if (contentText.length < 200) {
      console.log("   [" + (idx + 1) + "] Skip (poco texto):", title.slice(0, 50));
      continue;
    }
    const contentHash = sha256(contentText);
    const { canonical_key, type, number } = deriveCanonicalFromTitle(title, url);
    const published = extractPublishedDate(rawMarkdown, doc.metadata) ?? new Date().toISOString().slice(0, 10);

    const upsert = await upsertInstrument(supabase, canonical_key, title, type, number);
    if ("error" in upsert) {
      console.warn("   No se pudo crear instrument:", canonical_key, upsert.error);
      continue;
    }
    const instrumentId = upsert.instrumentId;

    const result = await ingestVersionAndChunks(supabase, openai, {
      instrumentId,
      sourceId,
      sourceUrl: url,
      contentText,
      contentHash,
      publishedDate: published,
      canonicalKey: canonical_key,
    });

    if (!result.ok) {
      if ("skipped" in result && result.skipped === "dedup-by-hash") {
        console.log("   [" + (idx + 1) + "]", canonical_key, "→ misma versión (hash igual), skip");
      } else {
        console.warn("   Error insertando versión:", canonical_key, "error" in result ? result.error : "");
      }
      continue;
    }
    console.log("   [" + (idx + 1) + "]", canonical_key, "→ nueva versión", result.versionId, "(", result.chunksCount, "chunks )");
  }

  console.log("Listo. Procesados", filtered.length, "documentos.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
