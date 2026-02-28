/**
 * Pipeline reutilizable para ingesta desde consultoria.gov.do.
 * Usado por: scripts/crawl_consultoria.ts, scripts/enrich_queue.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { createHash } from "crypto";

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export type CrawlDocMetadata = {
  title?: string;
  sourceURL?: string;
  url?: string;
  description?: string;
  [k: string]: unknown;
};

export type CrawlDoc = {
  markdown?: string;
  metadata?: CrawlDocMetadata;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }
  return chunks;
}

export function deriveCanonicalFromTitle(
  title: string,
  url: string
): { canonical_key: string; type: string; number: string | null } {
  const t = title || "";
  const ley = t.match(/(?:Ley|LEY)\s*(?:No\.?|Nº?\s*)?(\d{2,3}-\d{2})/i);
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

export function extractPublishedDate(markdown: string, metadata: CrawlDoc["metadata"]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const text = (markdown || "") + " " + (metadata?.description || "");
  const yyyy = text.match(/(\d{4})/g);
  if (yyyy && yyyy.length > 0) {
    const years = [...new Set(yyyy)].map(Number).filter((y) => y >= 1990 && y <= 2030);
    if (years.length > 0) return `${Math.max(...years)}-01-01`;
  }
  return today;
}

/** Obtiene o crea el source ConsultoriaGovDo. */
export async function ensureConsultoriaSourceId(supabase: SupabaseClient): Promise<string | null> {
  const { data: existingSource } = await supabase
    .from("sources")
    .select("id")
    .eq("name", "ConsultoriaGovDo")
    .eq("base_url", "https://www.consultoria.gov.do/")
    .maybeSingle();
  if (existingSource?.id) return existingSource.id;
  const { data: inserted } = await supabase
    .from("sources")
    .insert({ name: "ConsultoriaGovDo", base_url: "https://www.consultoria.gov.do/" })
    .select("id")
    .single();
  return inserted?.id ?? null;
}

export type UpsertInstrumentResult = { instrumentId: string } | { error: string };

/** Crea o actualiza instrument por canonical_key; devuelve instrument_id. */
export async function upsertInstrument(
  supabase: SupabaseClient,
  canonical_key: string,
  title: string,
  type: string,
  number: string | null
): Promise<UpsertInstrumentResult> {
  const { data: inst } = await supabase.from("instruments").select("id").eq("canonical_key", canonical_key).maybeSingle();
  if (inst?.id) {
    await supabase.from("instruments").update({ title, type, number: number ?? undefined }).eq("id", inst.id);
    return { instrumentId: inst.id };
  }
  const { data: inserted, error } = await supabase
    .from("instruments")
    .insert({ canonical_key, title, type, number: number ?? undefined })
    .select("id")
    .single();
  if (error || !inserted?.id) return { error: error?.message ?? "insert failed" };
  return { instrumentId: inserted.id };
}

export type IngestVersionAndChunksResult =
  | { ok: true; versionId: string; chunksCount: number }
  | { ok: false; skipped: "dedup-by-hash" }
  | { ok: false; error: string };

/**
 * Inserta nueva versión VIGENTE (deroga anteriores del mismo instrument), chunks con embeddings.
 * Si ya existe instrument_version con mismo content_hash, retorna skipped.
 */
export async function ingestVersionAndChunks(
  supabase: SupabaseClient,
  openai: OpenAI,
  params: {
    instrumentId: string;
    sourceId: string;
    sourceUrl: string;
    contentText: string;
    contentHash: string;
    publishedDate: string;
    canonicalKey: string;
  }
): Promise<IngestVersionAndChunksResult> {
  const { instrumentId, sourceId, sourceUrl, contentText, contentHash, publishedDate } = params;

  const { data: existingVersion } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("instrument_id", instrumentId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existingVersion?.id) return { ok: false, skipped: "dedup-by-hash" };

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
      published_date: publishedDate,
      effective_date: null,
      status: "VIGENTE",
      source_url: sourceUrl,
      gazette_ref: null,
      content_text: contentText,
      content_hash: contentHash,
    })
    .select("id")
    .single();
  if (verErr || !newVersion?.id) return { ok: false, error: verErr?.message ?? "version insert failed" };
  const versionId = newVersion.id;

  const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
  for (let i = 0; i < chunks.length; i++) {
    const embRes = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunks[i].slice(0, 8000),
    });
    const embedding = embRes.data[0]?.embedding ?? [];
    await supabase.from("instrument_chunks").insert({
      instrument_version_id: versionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
  }
  return { ok: true, versionId, chunksCount: chunks.length };
}
