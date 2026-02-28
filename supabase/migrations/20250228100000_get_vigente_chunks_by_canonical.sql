-- Chunks de un instrumento VIGENTE por canonical_key (para asegurar que la ley solicitada aparezca en RAG).
CREATE OR REPLACE FUNCTION public.get_vigente_chunks_by_canonical_key(
  p_canonical_key TEXT,
  p_match_count INT DEFAULT 8
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
    AND i.canonical_key = p_canonical_key
  ORDER BY c.chunk_index
  LIMIT p_match_count;
$$ LANGUAGE sql STABLE;
