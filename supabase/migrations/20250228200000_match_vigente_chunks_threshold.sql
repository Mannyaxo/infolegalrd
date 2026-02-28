-- Añade parámetro opcional match_threshold a match_vigente_chunks.
-- Si se pasa, solo se devuelven chunks con similitud >= threshold (filtra ruido).

CREATE OR REPLACE FUNCTION public.match_vigente_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 8,
  match_threshold float DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  instrument_version_id uuid,
  chunk_index int,
  chunk_text text,
  instrument_title text,
  instrument_type text,
  instrument_number text,
  published_date date,
  effective_date date,
  status text,
  source_url text,
  gazette_ref text,
  canonical_key text,
  similarity real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.instrument_version_id,
    c.chunk_index,
    c.chunk_text,
    i.title AS instrument_title,
    i.type AS instrument_type,
    COALESCE(i.number, '') AS instrument_number,
    v.published_date,
    v.effective_date,
    v.status,
    v.source_url,
    v.gazette_ref,
    i.canonical_key,
    (1 - (c.embedding <=> query_embedding))::real AS similarity
  FROM public.instrument_chunks c
  JOIN public.instrument_versions v ON v.id = c.instrument_version_id
  JOIN public.instruments i ON i.id = v.instrument_id
  WHERE v.status = 'VIGENTE'
    AND c.embedding IS NOT NULL
    AND (match_threshold IS NULL OR (1 - (c.embedding <=> query_embedding)) >= match_threshold)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_vigente_chunks(vector(1536), int, float) TO anon;
GRANT EXECUTE ON FUNCTION public.match_vigente_chunks(vector(1536), int, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_vigente_chunks(vector(1536), int, float) TO service_role;
