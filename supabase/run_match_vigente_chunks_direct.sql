-- ============================================================
-- Ejecutar en Supabase Dashboard → SQL Editor (proyecto activo)
-- RAG: función match_vigente_chunks SIN índice (evita error 54000 maintenance_work_mem)
-- ============================================================

-- 1) Extensión
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Función (sin crear índice)
CREATE OR REPLACE FUNCTION public.match_vigente_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 8
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
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.instrument_version_id,
    c.chunk_index,
    c.chunk_text,
    i.title,
    i.type,
    COALESCE(i.number, ''),
    v.published_date,
    v.effective_date,
    v.status,
    v.source_url,
    v.gazette_ref,
    i.canonical_key,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.instrument_chunks c
  JOIN public.instrument_versions v ON v.id = c.instrument_version_id
  JOIN public.instruments i ON i.id = v.instrument_id
  WHERE v.status = 'VIGENTE'
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 3) Permisos
GRANT EXECUTE ON FUNCTION public.match_vigente_chunks(vector(1536), int)
TO anon, authenticated, service_role;

-- ============================================================
-- VERIFICACIÓN 1: que la función exista (ejecutar en otra pestaña o después)
-- ============================================================
-- SELECT n.nspname AS schema, p.proname AS name, p.oid::regprocedure AS signature
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE p.proname = 'match_vigente_chunks';
-- Esperado: 1 fila, schema = public

-- ============================================================
-- VERIFICACIÓN 2: prueba con embedding real (ejecutar después)
-- ============================================================
-- SELECT COUNT(*) AS filas_devueltas
-- FROM public.match_vigente_chunks(
--   (
--     SELECT c.embedding::vector(1536)
--     FROM public.instrument_chunks c
--     JOIN public.instrument_versions v ON v.id = c.instrument_version_id
--     WHERE v.status = 'VIGENTE' AND c.embedding IS NOT NULL
--     LIMIT 1
--   ),
--   5
-- );
-- Esperado: filas_devueltas >= 1

-- ============================================================
-- OPCIONAL: índice liviano (lists=10). Si falla por memoria, ignorar.
-- ============================================================
-- CREATE INDEX IF NOT EXISTS instrument_chunks_embedding_ivfflat
--   ON public.instrument_chunks
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 10);
