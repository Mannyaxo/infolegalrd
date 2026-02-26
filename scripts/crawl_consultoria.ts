import "dotenv/config";
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createHash } from "crypto";

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
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";
const URL_KEYWORDS = /ley|decreto|resolucion|constitucion/i;

type CrawlDoc = {
  markdown?: string;
  metadata?: { title?: string; sourceURL?: string; url?: string; [k: string]: unknown };
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }
  return chunks;
}

function deriveCanonicalFromTitle(title: string, url: string): { canonical_key: string; type: string; number: string | null } {
  const t = title || "";
  const ley = t.match(/(?:Ley|LEY)\s*(\d{2,3}-\d{2})/i);
  const decreto = t.match(/Decreto\s*(\d{2,3}-\d{2})/i);
  const resolucion = t.match(/Resoluci[oó]n\s*(\d{2,3}-\d{2})/i);
  const constitucion = /constitucion/i.test(t) || /constitucion/i.test(url);
  if (constitucion) return { canonical_key: "CONSTITUCION-RD", type: "constitucion", number: null };
  if (decreto) return { canonical_key: `DECRETO-${decreto[1]}`, type: "decreto", number: decreto[1] };
  if (resolucion) return { canonical_key: `RESOLUCION-${resolucion[1]}`, type: "resolucion", number: resolucion[1] };
  if (ley) return { canonical_key: `LEY-${ley[1]}`, type: "ley", number: ley[1] };
  const fallback = t.slice(0, 60).replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "") || "CONSULTORIA";
  return { canonical_key: fallback.toUpperCase(), type: "ley", number: null };
}

function extractPublishedDate(markdown: string, metadata: CrawlDoc["metadata"]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const text = (markdown || "") + " " + (metadata?.description || "");
  const yyyy = text.match(/(\d{4})/g);
  if (yyyy && yyyy.length > 0) {
    const years = [...new Set(yyyy)].map(Number).filter((y) => y >= 1990 && y <= 2030);
    if (years.length > 0) return `${Math.max(...years)}-01-01`;
  }
  return today;
}

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

  let sourceId: string | null = null;
  const { data: existingSource } = await supabase
    .from("sources")
    .select("id")
    .eq("name", "ConsultoriaGovDo")
    .eq("base_url", "https://www.consultoria.gov.do/")
    .maybeSingle();
  if (existingSource?.id) {
    sourceId = existingSource.id;
  } else {
    const { data: inserted } = await supabase
      .from("sources")
      .insert({ name: "ConsultoriaGovDo", base_url: "https://www.consultoria.gov.do/" })
      .select("id")
      .single();
    sourceId = inserted?.id ?? null;
  }
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
    const published = extractPublishedDate(rawMarkdown, doc.metadata);

    let instrumentId: string | null = null;
    const { data: inst } = await supabase.from("instruments").select("id").eq("canonical_key", canonical_key).maybeSingle();
    if (inst?.id) {
      instrumentId = inst.id;
      await supabase.from("instruments").update({ title, type, number: number ?? undefined }).eq("id", instrumentId);
    } else {
      const { data: inserted } = await supabase
        .from("instruments")
        .insert({ canonical_key, title, type, number: number ?? undefined })
        .select("id")
        .single();
      instrumentId = inserted?.id ?? null;
    }
    if (!instrumentId) {
      console.warn("   No se pudo crear instrument:", canonical_key);
      continue;
    }

    const { data: existingVersion } = await supabase
      .from("instrument_versions")
      .select("id")
      .eq("instrument_id", instrumentId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    let versionId: string;
    if (existingVersion?.id) {
      console.log("   [" + (idx + 1) + "]", canonical_key, "→ misma versión (hash igual), skip");
      continue;
    }

    await supabase
      .from("instrument_versions")
      .update({ status: "DEROGADA" })
      .eq("instrument_id", instrumentId)
      .eq("status", "VIGENTE");
    const { data: newVersion, error: verErr } = await supabase
      .from("instrument_versions")
      .insert({
        instrument_id: instrumentId,
        source_id: sourceId,
        published_date: published,
        effective_date: null,
        status: "VIGENTE",
        source_url: url,
        gazette_ref: null,
        content_text: contentText,
        content_hash: contentHash,
      })
      .select("id")
      .single();
    if (verErr || !newVersion?.id) {
      console.warn("   Error insertando versión:", canonical_key, verErr?.message);
      continue;
    }
    versionId = newVersion.id;

    const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
    for (let i = 0; i < chunks.length; i++) {
      const embRes = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: chunks[i].slice(0, 8000) });
      const embedding = embRes.data[0]?.embedding ?? [];
      await supabase.from("instrument_chunks").insert({
        instrument_version_id: versionId,
        chunk_index: i,
        chunk_text: chunks[i],
        embedding,
      });
    }
    console.log("   [" + (idx + 1) + "]", canonical_key, "→ nueva versión", versionId, "(", chunks.length, "chunks )");
  }

  console.log("Listo. Procesados", filtered.length, "documentos.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
