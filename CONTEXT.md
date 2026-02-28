# InfoLegal RD — Contexto del Proyecto

## Stack
- Next.js 14 App Router + TypeScript
- Supabase (Postgres + pgvector para RAG)
- Multi-provider LLM: Claude (primario), OpenAI (fallback/embeddings), xAI, Gemini, Groq
- Patrón Lawyer–Judge + verificación de claims (estilo Harvey) para modo máxima confiabilidad
- Deploy en Vercel

## Arquitectura RAG (ya implementada)
- **Embeddings:** OpenAI text-embedding-3-small (1536 dims)
- **Vector store:** Supabase pgvector en `instrument_chunks` (ivfflat, cosine)
- **Schema:** `sources` → `instruments` → `instrument_versions` → `instrument_chunks` (con versión vigente/derogada, canonical_key, source_url)
- **RPC:** `match_vigente_chunks(query_embedding, match_count, match_threshold?)` — solo instrumentos VIGENTE; umbral opcional (ej. 0.65) filtra por similitud
- **Leyes por nombre:** `get_vigente_chunks_by_canonical_key` para consultas tipo "ley 47-25"
- **Flujo:** Query → embedQuery → retrieveVigenteChunks (+ merge por ley si aplica) → formatVigenteContext → LLM (Researcher) → Judge → Claim verification → Respuesta con fuentes

## Legislación
- Ingesta: `scripts/ingest_manual.ts`, `scripts/enrich_queue.ts` (auto-enriquecimiento desde consultoria.gov.do / gacetaoficial.gob.do)
- Chunking: 1000 caracteres, 150 de solape (`_consultoria_pipeline.ts`)

## Variables de entorno
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (RAG, API, ingesta)
- `OPENAI_API_KEY` (embeddings + fallback / verificación)
- `ANTHROPIC_API_KEY` (modo máxima confiabilidad)
- Opcional: `FIRECRAWL_API_KEY` (enrich), `AUTO_RUN_ENRICH_QUEUE` (false para desactivar worker al encolar)

## Rutas API relevantes
- `POST /api/chat` — Chat con RAG, modos normal y max-reliability
- `POST /api/rag-probe` — Prueba de recuperación RAG (debug)
- `POST /api/feedback` — Feedback de usuario

## Documentación
- **`PROBAR.md`** — Guía rápida: dónde estoy, qué probar, comandos (empezar por aquí para testing).
- `docs/SCRIPTS_INFOLEGAL_RD.md` — Referencia de scripts, APIs, variables, migraciones.
