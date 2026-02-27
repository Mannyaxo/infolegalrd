-- Cola de auto-enriquecimiento cuando RAG no encuentra evidencia (chunks = 0).
-- El worker (scripts/enrich_queue.ts) procesa PENDING y hace ingesta desde consultoria.gov.do.

CREATE TABLE IF NOT EXISTS public.corpus_enrichment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  mode TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'FETCHING', 'FETCHED', 'FETCHED_REVIEW',
      'INGESTING', 'INGESTED', 'FAILED'
    )),
  source_url TEXT,
  title TEXT,
  canonical_key TEXT,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_corpus_enrichment_queue_status_created
  ON public.corpus_enrichment_queue (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_corpus_enrichment_queue_canonical_key
  ON public.corpus_enrichment_queue (canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corpus_enrichment_queue_content_hash
  ON public.corpus_enrichment_queue (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corpus_enrichment_queue_query
  ON public.corpus_enrichment_queue (query);

-- RLS: service_role puede todo; anon/authenticated no acceden (la cola es solo backend/worker).
ALTER TABLE public.corpus_enrichment_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access corpus_enrichment_queue"
  ON public.corpus_enrichment_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.corpus_enrichment_queue IS
  'Cola de enriquecimiento cuando /api/chat no encuentra chunks (NO_EVIDENCE). Worker enrich_queue.ts procesa PENDING.';
