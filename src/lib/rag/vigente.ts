/**
 * RAG: chunks de cualquier instrumento VIGENTE (usa match_vigente_chunks).
 * Para modo max-reliability con ingesta manual (Constitución u otros).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getEmbedding } from "./embeddings";

export type VigenteCitation = {
  title: string;
  source_url: string;
  published_date: string;
  effective_date?: string | null;
  status: string;
  type?: string;
  number?: string | null;
  gazette_ref?: string | null;
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
  effective_date?: string | null;
  status: string;
  source_url: string;
  gazette_ref: string | null;
  canonical_key: string;
};

/** Genera embedding del query para RAG (OpenAI text-embedding-3-small, 1536 dims). */
export async function embedQuery(text: string): Promise<number[]> {
  return getEmbedding(text);
}

/**
 * Recupera topK chunks de instrumentos VIGENTES por embedding (cosine similarity).
 * Para modo max-reliability: usar con embedQuery(query).
 */
export async function retrieveVigenteChunksWithEmbedding(
  supabase: SupabaseClient,
  embedding: number[],
  topK: number = 6
): Promise<VigenteChunk[]> {
  if (embedding.length === 0) return [];

  const { data: rows, error } = await (supabase as unknown as { rpc(n: string, p: object): Promise<{ data: MatchVigenteRow[] | null; error: { message?: string; details?: string } | null }> }).rpc(
    "match_vigente_chunks",
    { query_embedding: embedding, match_count: topK }
  );

  if (error) {
    const errMsg = error?.message ?? (typeof error === "string" ? error : JSON.stringify(error));
    console.error("[RAG] match_vigente_chunks RPC error:", errMsg, error?.details ?? "");
    throw new Error(errMsg);
  }
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    chunk_text: row.chunk_text,
    chunk_index: row.chunk_index,
    citation: {
      title: row.instrument_title ?? "",
      source_url: row.source_url ?? "",
      published_date: row.published_date ?? "",
      effective_date: row.effective_date ?? null,
      status: row.status ?? "VIGENTE",
      type: row.instrument_type,
      number: row.instrument_number ?? null,
      gazette_ref: row.gazette_ref ?? null,
      canonical_key: row.canonical_key ?? undefined,
    },
  }));
}

/**
 * Recupera topK chunks relevantes (por query string). Usa getSupabaseServer + embedQuery internamente.
 */
export async function retrieveVigenteChunks(query: string, topK: number = 6): Promise<VigenteChunk[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const embedding = await embedQuery(query);
  return retrieveVigenteChunksWithEmbedding(supabase, embedding, topK);
}

/**
 * Recupera chunks de un instrumento VIGENTE por canonical_key (ej. LEY-590-16).
 * Primero intenta el RPC get_vigente_chunks_by_canonical_key; si falla o no existe, usa consultas directas a tablas.
 */
export async function retrieveVigenteChunksByCanonicalKey(
  canonicalKey: string,
  limit: number = 8
): Promise<VigenteChunk[]> {
  const supabase = getSupabaseServer();
  if (!supabase || !canonicalKey?.trim()) return [];

  const key = canonicalKey.trim();

  // 1) Intentar RPC (requiere migración 20250228100000)
  try {
    const { data: rows, error } = await (supabase as unknown as {
      rpc(n: string, p: { p_canonical_key: string; p_match_count: number }): Promise<{
        data: MatchVigenteRow[] | null;
        error: { message?: string } | null;
      }>;
    }).rpc("get_vigente_chunks_by_canonical_key", {
      p_canonical_key: key,
      p_match_count: limit,
    });
    if (!error && Array.isArray(rows) && rows.length > 0) {
      return rows.map((row) => ({
        chunk_text: row.chunk_text,
        chunk_index: row.chunk_index,
        citation: {
          title: row.instrument_title ?? "",
          source_url: row.source_url ?? "",
          published_date: row.published_date ?? "",
          effective_date: row.effective_date ?? null,
          status: row.status ?? "VIGENTE",
          type: row.instrument_type,
          number: row.instrument_number ?? null,
          gazette_ref: row.gazette_ref ?? null,
          canonical_key: row.canonical_key ?? undefined,
        },
      }));
    }
  } catch {
    // RPC puede no existir si la migración no se aplicó
  }

  // 2) Fallback: consultas directas a instruments → instrument_versions → instrument_chunks
  try {
    type InstRow = { id: string; title: string | null; type: string | null; number: string | null };
    let inst: InstRow | null = null;
    const { data: byKey, error: eKey } = await supabase
      .from("instruments")
      .select("id, title, type, number")
      .eq("canonical_key", key)
      .limit(1)
      .maybeSingle();
    if (!eKey && byKey) inst = byKey as InstRow;
    // Si no hay por canonical_key, intentar por número (ej. LEY-590-16 → number 590-16)
    if (!inst && key.startsWith("LEY-")) {
      const num = key.replace(/^LEY-/, "");
      const { data: byNum } = await supabase
        .from("instruments")
        .select("id, title, type, number")
        .eq("number", num)
        .eq("type", "ley")
        .limit(1)
        .maybeSingle();
      if (byNum) inst = byNum as InstRow;
    }
    if (!inst) return [];

    type VersionRow = { id: string; source_url: string | null; published_date: string | null; effective_date: string | null; status: string | null; gazette_ref: string | null };
    type ChunkRow = { chunk_index: number; chunk_text: string | null };
    const { data: versData, error: e2 } = await supabase
      .from("instrument_versions")
      .select("id, source_url, published_date, effective_date, status, gazette_ref")
      .eq("instrument_id", inst.id)
      .eq("status", "VIGENTE")
      .order("published_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const vers = versData as VersionRow | null;
    if (e2 || !vers) return [];

    const { data: chunksData, error: e3 } = await supabase
      .from("instrument_chunks")
      .select("chunk_index, chunk_text")
      .eq("instrument_version_id", vers.id)
      .order("chunk_index")
      .limit(limit);
    const chunks = (Array.isArray(chunksData) ? chunksData : []) as ChunkRow[];
    if (e3 || chunks.length === 0) return [];

    const published = vers.published_date ? String(vers.published_date).slice(0, 10) : "";
    return chunks.map((c) => ({
      chunk_text: c.chunk_text ?? "",
      chunk_index: c.chunk_index ?? 0,
      citation: {
        title: inst.title ?? "",
        source_url: vers.source_url ?? "",
        published_date: published,
        effective_date: vers.effective_date ?? null,
        status: vers.status ?? "VIGENTE",
        type: inst.type ?? "ley",
        number: inst.number ?? null,
        gazette_ref: vers.gazette_ref ?? null,
        canonical_key: key,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Contexto formateado para el prompt: encabezado por versión (metadata verificada) + chunks + aviso.
 * Incluye title, type/number, published_date, effective_date (si existe), source_url, gazette_ref (si existe).
 */
export function formatVigenteContext(chunks: VigenteChunk[], maxChars: number = 12000): {
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
  const versionKey = (c: VigenteChunk) =>
    `${c.citation.title}|${c.citation.source_url}|${c.citation.published_date}`;
  const parts: string[] = [];
  let currentKey: string | null = null;
  for (const c of chunks) {
    const key = versionKey(c);
    if (key !== currentKey) {
      currentKey = key;
      const cit = c.citation;
      const headerLines = [
        "[Versión verificada]",
        `Instrumento: ${cit.title ?? ""}`,
        `Tipo / Número: ${cit.type ?? ""} ${cit.number ?? ""}`.trim(),
        `Fecha promulgación (published_date): ${cit.published_date ?? ""}`,
        ...(cit.effective_date ? [`Fecha efectividad (effective_date): ${cit.effective_date}`] : []),
        `URL: ${cit.source_url ?? ""}`,
        ...(cit.gazette_ref ? [`Gaceta / referencia: ${cit.gazette_ref}`] : []),
      ];
      parts.push(headerLines.join("\n"));
      parts.push("---");
    }
    parts.push(c.chunk_text);
  }
  const contextText = parts.join("\n\n") + "\n\nSolo estas fuentes cuentan como verificadas.";
  return { text: contextText.slice(0, maxChars), citations };
}

/** Encabezado por chunk para modo max-reliability: [Fuente #i | instrumento | versión | chunk_index | url] */
export function formatMaxReliabilityContext(chunks: VigenteChunk[], maxChars: number = 12000): { contextText: string; allChunkText: string } {
  if (chunks.length === 0) return { contextText: "", allChunkText: "" };
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const instrument = c.citation.title ?? "";
    const version = c.citation.published_date ?? "";
    const url = c.citation.source_url ?? "";
    const header = `[Fuente #${i + 1} | ${instrument} | ${version} | chunk_index: ${c.chunk_index} | ${url}]`;
    parts.push(`${header}\n${c.chunk_text}`);
  }
  const full = parts.join("\n\n---\n\n");
  return { contextText: full.slice(0, maxChars), allChunkText: parts.map((p) => p.replace(/^\[[\s\S]*?\]\n/, "")).join("\n") };
}
