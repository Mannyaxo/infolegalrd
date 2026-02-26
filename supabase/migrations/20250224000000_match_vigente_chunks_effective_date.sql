-- Añade effective_date al RPC match_vigente_chunks para contexto RAG (metadata verificada).
CREATE OR REPLACE FUNCTION public.match_vigente_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 6
)
RETURNS TABLE (
  id UUID,
  instrument_version_id UUID,
  chunk_index INT,
  chunk_text TEXT,
  instrument_title TEXT,
  instrument_type TEXT,
  instrument_number TEXT,
  published_date DATE,
  effective_date DATE,
  status TEXT,
  source_url TEXT,
  gazette_ref TEXT,
  canonical_key TEXT
) AS $$
  SELECT
    c.id,
    c.instrument_version_id,
    c.chunk_index,
    c.chunk_text,
    i.title AS instrument_title,
    i.type AS instrument_type,
    i.number AS instrument_number,
    v.published_date,
    v.effective_date,
    v.status,
    v.source_url,
    v.gazette_ref,
    i.canonical_key
  FROM public.instrument_chunks c
  JOIN public.instrument_versions v ON v.id = c.instrument_version_id
  JOIN public.instruments i ON i.id = v.instrument_id
  WHERE v.status = 'VIGENTE'
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
