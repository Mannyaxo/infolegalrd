/**
 * RAG: chunks de cualquier instrumento VIGENTE (usa match_vigente_chunks).
 * Para modo max-reliability con ingesta manual (Constitución u otros).
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { getEmbedding } from "./embeddings";

export type VigenteCitation = {
  title: string;
  source_url: string;
  published_date: string;
  status: string;
  type?: string;
  number?: string | null;
  canonical_key?: string;
};

export type VigenteChunk = {
  chunk_text: string;
  chunk_index: number;
  citation: VigenteCitation;
};

type MatchVigenteRow = {
  id: string;
  instrument_version_id: string;
  chunk_index: number;
  chunk_text: string;
  instrument_title: string;
  instrument_type: string;
  instrument_number: string | null;
  published_date: string;
  status: string;
  source_url: string;
  gazette_ref: string | null;
  canonical_key: string;
};

/**
 * Recupera topK chunks relevantes de todos los instrumentos VIGENTES (cosine similarity).
 */
export async function retrieveVigenteChunks(
  query: string,
  topK: number = 6
): Promise<VigenteChunk[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];

  const embedding = await getEmbedding(query);
  if (embedding.length === 0) return [];

  const { data: rows, error } = await (supabase as any).rpc("match_vigente_chunks", {
    query_embedding: embedding,
    match_count: topK,
  });

  if (error || !Array.isArray(rows)) return [];

  return (rows as MatchVigenteRow[]).map((row) => ({
    chunk_text: row.chunk_text,
    chunk_index: row.chunk_index,
    citation: {
      title: row.instrument_title ?? "",
      source_url: row.source_url ?? "",
      published_date: row.published_date ?? "",
      status: row.status ?? "VIGENTE",
      type: row.instrument_type,
      number: row.instrument_number ?? null,
      canonical_key: row.canonical_key ?? undefined,
    },
  }));
}

/**
 * Contexto formateado para el prompt + lista de citas únicas para Fuentes y legal_audit_log.
 */
export function formatVigenteContext(chunks: VigenteChunk[]): {
  text: string;
  citations: VigenteCitation[];
} {
  if (chunks.length === 0) return { text: "", citations: [] };
  const seen = new Set<string>();
  const citations: VigenteCitation[] = [];
  for (const c of chunks) {
    const key = `${c.citation.title}|${c.citation.source_url}|${c.citation.published_date}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push(c.citation);
    }
  }
  const text = chunks
    .map((c) => c.chunk_text)
    .join("\n\n---\n\n")
    .slice(0, 12000);
  return { text, citations };
}
