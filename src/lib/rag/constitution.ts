/**
 * RAG piloto: Constitución RD. Solo versión VIGENTE.
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { getEmbedding } from "./embeddings";

export type ConstitutionCitation = {
  instrument: string;
  canonical_key: string;
  published_date: string;
  source_url: string;
  gazette_ref?: string | null;
};

export type ConstitutionChunk = {
  chunk_text: string;
  chunk_index: number;
  citation: ConstitutionCitation;
};

type InstrumentVersionRow = {
  id: string;
  published_date: string;
  source_url: string;
  gazette_ref: string | null;
  status: string;
};

type MatchChunkRow = {
  id: string;
  instrument_version_id: string;
  chunk_index: number;
  chunk_text: string;
  published_date: string;
  source_url: string;
  gazette_ref: string | null;
  instrument_title: string;
  canonical_key: string;
};

const CONSTITUCION_CANONICAL_KEY = "CONSTITUCION-RD";

/**
 * Obtiene la versión VIGENTE del instrumento (por defecto Constitución RD).
 */
export async function getVigenteVersion(
  canonicalKey: string = CONSTITUCION_CANONICAL_KEY
): Promise<InstrumentVersionRow | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return null;

  const { data: inst } = await (supabase as any)
    .from("instruments")
    .select("id")
    .eq("canonical_key", canonicalKey)
    .maybeSingle();

  if (!inst?.id) return null;

  const { data: version } = await (supabase as any)
    .from("instrument_versions")
    .select("id, published_date, source_url, gazette_ref, status")
    .eq("instrument_id", inst.id)
    .eq("status", "VIGENTE")
    .order("published_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return version;
}

/**
 * Recupera chunks de la Constitución RD relevantes a la query (solo versión vigente).
 * Incluye metadata de cita para Fuentes / Versión.
 */
export async function retrieveConstitutionChunks(
  query: string,
  topK: number = 6
): Promise<ConstitutionChunk[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];

  const embedding = await getEmbedding(query);
  if (embedding.length === 0) return [];

  const { data: rows, error } = await (supabase as any).rpc("match_constitution_chunks", {
    query_embedding: embedding,
    match_count: topK,
  });

  if (error || !Array.isArray(rows)) return [];

  return (rows as MatchChunkRow[]).map((row) => ({
    chunk_text: row.chunk_text,
    chunk_index: row.chunk_index,
    citation: {
      instrument: row.instrument_title ?? "Constitución RD",
      canonical_key: row.canonical_key ?? CONSTITUCION_CANONICAL_KEY,
      published_date: row.published_date ?? "",
      source_url: row.source_url ?? "",
      gazette_ref: row.gazette_ref ?? null,
    },
  }));
}

/**
 * Formatea el contexto RAG para inyectar en el prompt (texto + cita única).
 */
export function formatConstitutionContext(chunks: ConstitutionChunk[]): {
  text: string;
  citation: ConstitutionCitation | null;
} {
  if (chunks.length === 0) return { text: "", citation: null };
  const citation = chunks[0].citation;
  const text = chunks
    .map((c) => c.chunk_text)
    .join("\n\n---\n\n")
    .slice(0, 12000);
  return { text, citation };
}
