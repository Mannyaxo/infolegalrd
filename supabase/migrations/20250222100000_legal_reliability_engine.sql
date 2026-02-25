-- Legal Reliability Engine v1 + RAG (Piloto Constitución RD)
-- No reemplaza tablas existentes. Ejecutar en SQL Editor de Supabase o via Supabase CLI.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1) sources
CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2) instruments
CREATE TABLE IF NOT EXISTS public.instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  number TEXT,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3) instrument_versions
CREATE TABLE IF NOT EXISTS public.instrument_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES public.instruments(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  published_date DATE NOT NULL,
  effective_date DATE,
  status TEXT NOT NULL CHECK (status IN ('VIGENTE','DEROGADA','PARCIAL')),
  source_url TEXT NOT NULL,
  gazette_ref TEXT,
  content_text TEXT,
  content_hash TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instrument_versions_instrument_status_date
  ON public.instrument_versions (instrument_id, status, published_date DESC);

-- 4) instrument_chunks (embeddings 1536 = OpenAI text-embedding-3-small / ada-002)
CREATE TABLE IF NOT EXISTS public.instrument_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_version_id UUID NOT NULL REFERENCES public.instrument_versions(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instrument_chunks_version_index
  ON public.instrument_chunks (instrument_version_id, chunk_index);

-- Índice vectorial (pgvector). Si falla en tablas vacías, ejecutar después de la primera ingesta.
-- Ajustar lists según tamaño del corpus (mínimo 1; recomendado ~sqrt(rows) para ivfflat).
CREATE INDEX IF NOT EXISTS instrument_chunks_embedding_idx
  ON public.instrument_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Función RPC para búsqueda por similitud (solo versión vigente Constitución)
CREATE OR REPLACE FUNCTION public.match_constitution_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 6
)
RETURNS TABLE (
  id UUID,
  instrument_version_id UUID,
  chunk_index INT,
  chunk_text TEXT,
  published_date DATE,
  source_url TEXT,
  gazette_ref TEXT,
  instrument_title TEXT,
  canonical_key TEXT
) AS $$
  SELECT
    c.id,
    c.instrument_version_id,
    c.chunk_index,
    c.chunk_text,
    v.published_date,
    v.source_url,
    v.gazette_ref,
    i.title AS instrument_title,
    i.canonical_key
  FROM public.instrument_chunks c
  JOIN public.instrument_versions v ON v.id = c.instrument_version_id
  JOIN public.instruments i ON i.id = v.instrument_id
  WHERE i.canonical_key = 'CONSTITUCION-RD'
    AND v.status = 'VIGENTE'
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- 5) legal_audit_log
CREATE TABLE IF NOT EXISTS public.legal_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  mode TEXT,
  query TEXT,
  decision TEXT,
  confidence NUMERIC,
  citations JSONB,
  model_used JSONB,
  tokens_in INT,
  tokens_out INT
);

-- RLS: tablas RAG/audit accesibles con service role; para anon/authenticated solo lectura de chunks/versions si se desea.
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sources read all" ON public.sources FOR SELECT USING (true);
CREATE POLICY "instruments read all" ON public.instruments FOR SELECT USING (true);
CREATE POLICY "instrument_versions read all" ON public.instrument_versions FOR SELECT USING (true);
CREATE POLICY "instrument_chunks read all" ON public.instrument_chunks FOR SELECT USING (true);
-- audit: solo service role inserta (desde API)
CREATE POLICY "legal_audit_log service insert" ON public.legal_audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "legal_audit_log read own or service" ON public.legal_audit_log FOR SELECT USING (true);
