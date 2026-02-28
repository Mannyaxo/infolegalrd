# Scripts y referencia técnica — InfoLegal RD

**Documento maestro del proyecto.** Todo lo que usa InfoLegal RD (scripts, APIs, variables de entorno, estructura, Supabase) debe estar referenciado aquí.  
Abrir en **Word**: Archivo → Abrir → este .md → Guardar como .docx.

> **REGLA DE ACTUALIZACIÓN:** Cada vez que cambies algo en el proyecto (scripts, rutas API, variables de entorno, nuevas migraciones, nuevos componentes o libs usados en producción), **actualiza este archivo** en la sección correspondiente. Este documento es la **fuente única de verdad** para operación y traspaso.

---

## Índice de scripts (scripts/)

| Archivo | Comando npm | Descripción |
|---------|-------------|-------------|
| `scripts/ingest_constitucion.ts` | `npm run ingest:constitucion` | Ingesta Constitución RD desde PDF (local o URL). |
| `scripts/ingest_manual.ts` | `npm run ingest:manual` | Ingesta manual en batch desde TXT (`--all` o `--files "path1,path2"`). |
| `scripts/crawl_consultoria.ts` | `npm run crawl:consultoria` | Crawl selectivo consultoria.gov.do con Firecrawl (ley/decreto/resolución/constitución). |
| `scripts/verify_rag_rpc.ts` | `npm run verify:rag` | Verifica que la RPC `match_vigente_chunks` exista y devuelva filas con embedding real. |
| `scripts/enrich_queue.ts` | `npm run enrich:queue` | Worker: procesa cola de auto-enriquecimiento (NO_EVIDENCE). Busca en consultoria.gov.do vía Firecrawl, ingesta con pipeline. Flags: `--once`, `--limit N`, `--dry-run`, `--force`. |
| `scripts/_consultoria_pipeline.ts` | — | Módulo reutilizable de ingesta consultoria (normalizeText, sha256, chunkText, deriveCanonicalFromTitle, ensureConsultoriaSourceId, upsertInstrument, ingestVersionAndChunks). Usado por crawl_consultoria y enrich_queue. |

---

## Índice de rutas API (src/app/api)

| Archivo | Ruta | Método | Descripción |
|---------|------|--------|-------------|
| `src/app/api/chat/route.ts` | `/api/chat` | POST | Orquestador del chat: RAG, modos normal y máxima confiabilidad, clarify. Body: `message`, `history`, `userId`, `mode`. |
| `src/app/api/feedback/route.ts` | `/api/feedback` | POST | Guarda feedback. Body: `query`, `response`, `feedback`, `timestamp`, `mode`, `userId`. Tabla `feedback`. |
| `src/app/api/consultas-limit/route.ts` | `/api/consultas-limit` | GET | Límite freemium. Query `userId` (opcional). Respuesta: `{ permitido, usadas, limite }`. |
| `src/app/api/consultas-limit/route.ts` | `/api/consultas-limit` | POST | Incrementa contador. Body: `{ userId }`. Respuesta: `{ ok }`. |
| `src/app/api/env-check/route.ts` | `/api/env-check` | GET | Comprueba env sin mostrar valores. Respuesta: `{ ok: true, env: { NEXT_PUBLIC_SUPABASE_URL: boolean, NEXT_PUBLIC_SUPABASE_ANON_KEY: boolean, SUPABASE_SERVICE_ROLE_KEY: boolean, urlHost: string \| null } }`. |

---

## Variables de entorno (.env.local / Vercel)

En **Vercel** las variables requeridas son: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (requerida para frontend), `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. No se usa `SUPABASE_URL` en Vercel.

| Variable | Uso | Obligatorio |
|--------|-----|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase (front y backend) | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Requerida para frontend (cliente público / auth) | Sí (front) |
| `SUPABASE_SERVICE_ROLE_KEY` | RAG, ingesta, feedback y **todo el backend** (API routes) | Sí (API/RAG) |
| `OPENAI_API_KEY` | Embeddings (RAG) y fallbacks | Sí (chat/ingesta) |
| `ANTHROPIC_API_KEY` | Orquestador del chat (Claude) | Sí (chat) |
| `XAI_API_KEY` | Fallback/agentes chat (xAI) | Opcional (chat) |
| `GEMINI_API_KEY` | Fallback/agentes chat (Gemini) | Opcional (chat) |
| `GROQ_API_KEY` | Fallback/agentes chat (Groq) | Opcional (chat) |
| `SERPER_API_KEY` | Búsqueda en fuentes oficiales RD (Serper) | Opcional (chat) |
| `FIRECRAWL_API_KEY` | Crawler consultoria.gov.do y **worker enrich:queue** (Firecrawl Search para candidatos) | Solo para crawl y enrich:queue |
| `CONSTITUCION_SOURCE_URL` | URL PDF Constitución (ingest) | Opcional |
| `CONSTITUCION_PUBLISHED_DATE` | Fecha promulgación (ingest) | Opcional |

**Importante:** El servidor (API, RAG, ingesta) usa **solo** `SUPABASE_SERVICE_ROLE_KEY`. No uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` en el backend (getSupabaseServer() no la usa). Sin `SUPABASE_SERVICE_ROLE_KEY` el RAG devuelve vacío y getSupabaseServer() retorna null.

---

## Comandos npm (package.json)

| Comando | Descripción |
|--------|-------------|
| `npm run dev` | Servidor de desarrollo Next.js |
| `npm run build` | Build de producción |
| `npm run start` | Iniciar servidor de producción |
| `npm run lint` | Linter |
| `npm run ingest:constitucion` | Ingesta Constitución RD desde PDF |
| `npm run ingest:manual` | Ingesta manual en batch (TXT) |
| `npm run crawl:consultoria` | Crawl selectivo consultoria.gov.do (Firecrawl) |
| `npm run verify:rag` | Verifica que exista la RPC match_vigente_chunks y que devuelva filas con un embedding real (chunk vigente) |
| `npm run enrich:queue` | Procesa la cola `corpus_enrichment_queue` (PENDING → ingest → INGESTED/FAILED). Requiere: FIRECRAWL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY. Opciones: `--once`, `--limit N`, `--dry-run`, `--force`. |

---

## Cola de auto-enriquecimiento (corpus_enrichment_queue)

Cuando el RAG no encuentra evidencia (`chunks.length === 0` en modo normal o `retrievedChunks.length === 0` en máxima confiabilidad), `/api/chat` **solo encola** la consulta en `corpus_enrichment_queue`; **nunca** invoca al worker. Un proceso externo ejecuta `npm run enrich:queue` para procesar la cola.

**Tabla:** `corpus_enrichment_queue` (migración `20250227000000_corpus_enrichment_queue.sql`).

| Columna | Tipo | Descripción |
|--------|------|-------------|
| `id` | uuid | PK, gen_random_uuid() |
| `query` | text | Consulta que no tuvo chunks |
| `mode` | text | `"normal"` \| `"max-reliability"` |
| `status` | text | Ver estados abajo |
| `source_url` | text | URL del documento ingerido (tras scrape) |
| `title` | text | Título del documento |
| `canonical_key` | text | Clave canónica del instrumento |
| `content_hash` | text | SHA256 del contenido normalizado |
| `created_at` | timestamptz | Alta en cola |
| `updated_at` | timestamptz | Última actualización |
| `error` | text | Mensaje si status = FAILED |
| `meta` | jsonb | Candidatos, note (dedup-by-hash), etc. |

**Estados de `status`:**  
`PENDING` → `FETCHING` → (si hay candidato) → `INGESTING` → `INGESTED` \| `FAILED`.  
Si no hay match confiable: `FETCHED_REVIEW` (se guardan `meta.candidates`).

**DEDUP al encolar:** No se inserta si en las últimas 24 h ya existe una fila con `status` en (`PENDING`, `FETCHING`, `FETCHED`, `FETCHED_REVIEW`, `INGESTING`) y la misma query (normalizada).

**Variables de entorno para el worker** `enrich:queue`: `FIRECRAWL_API_KEY`, `SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

---

## Rutas API (src/app/api)

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/chat` | POST | Orquestador del chat: RAG (match_vigente_chunks), modos normal y máxima confiabilidad, clarificar, síntesis. Body: `message`, `history`, `userId`, `mode`. El backend acepta aliases de modo: `max-reliability`, `max`, `máxima-confiabilidad`, `maxima`, `alta-confiabilidad`, etc. (se normalizan a isMax para entrar al flujo max-reliability). |
| `/api/rag-probe` | POST | Prueba de recuperación RAG sin invocar la IA. Misma lógica que chat: `retrieveVigenteChunks` + merge por ley (canonical_key). Body: `{ "message": "consulta" }`. Respuesta: `{ ok, total, chunks: [{ title, source_url, canonical_key, chunk_index, textPreview }], byCanonicalUsed?, askedCanonical? }`. Útil para afinar y depurar el RAG. |
| `/api/feedback` | POST | Guarda feedback de usuario. Body: `query`, `response`, `feedback`, `timestamp`, `mode`, `userId`. Tabla Supabase: `feedback` (migración `20250222120000_feedback.sql`: columnas `id`, `query`, `response`, `feedback`, `created_at`, `user_id`, `mode`). |
| `/api/consultas-limit` | GET | Límite freemium. Query: `userId` (opcional). Respuesta: `{ permitido: boolean, usadas: number, limite: number }`. Si falta `userId` devuelve permitido true, usadas 0, limite 5. |
| `/api/consultas-limit` | POST | Incrementa contador de consultas. Body: `{ userId: string }`. Respuesta: `{ ok: boolean }`. |
| `/api/env-check` | GET | Comprueba que existan variables de entorno (sin mostrar valores). |

---

## Estructura de archivos clave

**Scripts:** `scripts/ingest_constitucion.ts`, `scripts/ingest_manual.ts`, `scripts/crawl_consultoria.ts`, `scripts/verify_rag_rpc.ts` (ver Índice de scripts arriba).

**API:** `src/app/api/chat/route.ts`, `src/app/api/feedback/route.ts`, `src/app/api/consultas-limit/route.ts`, `src/app/api/env-check/route.ts` (ver Índice de rutas API arriba).

**Lib (backend/RAG):**
- `src/lib/supabase/server.ts` — `getSupabaseServer()` (solo `SUPABASE_SERVICE_ROLE_KEY`). Contenido completo en este doc.
- `src/lib/supabase/client.ts` — Cliente browser (anon key). Contenido completo en este doc.
- `src/lib/supabase/types.ts` — Tipos Database (consultas_diarias, faqs, usuarios_premium). Contenido completo en este doc.
- `src/lib/rag/vigente.ts` — `retrieveVigenteChunks`, `formatVigenteContext`, `formatMaxReliabilityContext`, RPC `match_vigente_chunks`. Contenido completo en este doc.
- `src/lib/rag/constitution.ts` — RAG Constitución RD (`match_constitution_chunks`). Contenido completo en este doc.
- `src/lib/rag/embeddings.ts` — `getEmbedding` (OpenAI text-embedding-3-small). Contenido completo en este doc.
- `src/lib/chat-guardrails.ts` — `DISCLAIMER_PREFIX`, `REFUSAL_MESSAGE`, `shouldRefuseIllegal`. Contenido completo en este doc.
- `src/lib/reliability/judge.ts` — `evaluateLegalAnswer` (Legal Reliability Engine, juez Claude). Contenido completo en este doc.

**Componentes (UI):**
- `src/components/chat/QueryPanel.tsx` — Panel de consulta en la home, envía a `/api/chat`, feedback a `/api/feedback`.
- `src/components/chat/Chatbot.tsx` — Chat con historial, modo normal / máxima confiabilidad.
- `src/components/home/DisclaimerHero.tsx` — Aviso/hero en la home.

**Supabase:**
- `supabase/migrations/` — Migraciones en orden: `20250222100000_legal_reliability_engine.sql`, `20250222120000_feedback.sql`, `20250223100000_match_vigente_chunks.sql`, `20250224000000_match_vigente_chunks_effective_date.sql`, `20250225000000_match_vigente_chunks_hierarchy.sql`, `20250226000000_create_match_vigente_chunks.sql`, `20250227000000_corpus_enrichment_queue.sql`.
- `supabase/run_match_vigente_chunks_direct.sql` — Script SQL para ejecutar en el SQL Editor de Supabase si la función no existe (crea extensión vector, función `match_vigente_chunks`, grants; índice opcional comentado).

**Raíz del proyecto:**
- `package.json` — Scripts npm (dev, build, start, lint, ingest:constitucion, ingest:manual, crawl:consultoria, verify:rag). Dependencias: next, react, @supabase/supabase-js, openai, etc. Engines: node 24.x.
- `next.config.mjs` — Next config (vacío por defecto: `const nextConfig = {}; export default nextConfig`).
- `tsconfig.json` — TypeScript: paths `@/*` → `./src/*`, include next-env.d.ts, **/*.ts, **/*.tsx, .next/types; exclude node_modules, scripts.
- `DEPLOY.md` — Pasos para redeploy en Vercel (commit/push, Redeploy en dashboard, variables de entorno). Contenido completo más abajo.
- `README.md` — Descripción del proyecto, stack, desarrollo local, ingesta RAG, despliegue, checklist env. Contenido completo más abajo.
- `.env.example`, `.env.local` — Variables de entorno (no versionar .env.local con secretos).

**Otros documentos:** `docs/INGESTA_LEYES.md` (cómo ingestar y verificar), `docs/INFORME_PROYECTO_INFOLEGAL_RD.md` (informe para traspaso/IA).

---

## src/lib/rag/vigente.ts (contenido completo)

Módulo RAG: chunks de instrumentos VIGENTES vía RPC `match_vigente_chunks`. Usado por el orquestador del chat (modo normal y máxima confiabilidad).

**Exporta:** tipos `VigenteCitation`, `VigenteChunk`; funciones `embedQuery`, `retrieveVigenteChunksWithEmbedding`, `retrieveVigenteChunks`, `formatVigenteContext`, `formatMaxReliabilityContext`.

**Dependencias:** `@/lib/supabase/server` (getSupabaseServer), `./embeddings` (getEmbedding).

```typescript
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
```

Al modificar `src/lib/rag/vigente.ts`, actualizar este bloque en el documento.

---

## src/lib/rag/constitution.ts (contenido completo)

RAG piloto solo para Constitución RD (versión VIGENTE). Usa RPC `match_constitution_chunks` si existe. Exporta tipos y funciones para chunks constitucionales.

```typescript
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
```

---

## src/lib/rag/embeddings.ts (contenido completo)

Embeddings para RAG con OpenAI text-embedding-3-small (1536 dimensiones).

```typescript
/**
 * Embeddings para RAG. Usa OpenAI text-embedding-3-small (1536 dims).
 */
import OpenAI from "openai";

const MODEL = "text-embedding-3-small";

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const openai = new OpenAI({ apiKey });
  const r = await openai.embeddings.create({
    model: MODEL,
    input: text.slice(0, 8000),
  });
  return r.data[0]?.embedding ?? [];
}
```

---

## src/lib/chat-guardrails.ts (contenido completo)

Guardrails del chat: rechazo solo para actos ilegales o instrucciones para delinquir; disclaimer previo en respuestas normales.

```typescript
/**
 * Guardrails para el chat legal: solo se rechaza solicitud de actos ilegales,
 * instrucciones paso a paso para delinquir, o representación/resultados garantizados.
 * Las consultas legales normales reciben respuesta con disclaimer previo.
 */

export const REFUSAL_MESSAGE =
  "Esta herramienta no puede ayudar con solicitudes que impliquen actos ilegales, falsificación, evasión fiscal ilícita ni instrucciones para delinquir. Consulte a un abogado colegiado para asuntos legales.";

export const DISCLAIMER_PREFIX =
  "Nota: información general, no asesoría legal profesional.\n\n";

function normalizeForCheck(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function shouldRefuseIllegal(userMessage: string): boolean {
  const t = normalizeForCheck(userMessage);
  if (t.length < 10) return false;
  const illegalPatterns = [
    /\bfalsificar\b/, /\bfalsear\b/,
    /\b(documento|certificado|firma)\s*(falso|falsificado)/,
    /\bevadir\s*(impuestos|tributos|hacienda|la ley)/i, /\bdefraudar\b/,
    /\bfraude\s*(tributario|fiscal)/i,
    /\binstrucciones?\s*para\s*(falsificar|evadir|defraudar)/i,
    /\bc[oó]mo\s*(falsificar|falsear|evadir\s*impuestos)/i,
    /\bpasos?\s*para\s*(falsificar|evadir|defraudar)/i,
    /\bdelinquir\b/, /\bcometer\s*(un\s*)?delito\b/,
    /\bhuir\s*(de\s*)?(la\s*)?justicia\b/,
    /\bocultar\s*(bienes|dinero)\s*(a\s*)?(hacienda|autoridades)/i,
    /\brepresentaci[oó]n\s*legal\s*personalizada\b/,
    /\bte\s*garantizo\b|\bgarantizo\s*que\b|\bresultado\s*garantizado\b/,
  ];
  return illegalPatterns.some((re) => re.test(t));
}
```

---

## src/lib/supabase/server.ts (contenido completo)

Cliente Supabase para servidor (API routes, RAG). Solo usa `SUPABASE_SERVICE_ROLE_KEY`.

```typescript
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cliente Supabase para uso en servidor (API routes, RAG, etc.).
 * Usa SOLO SUPABASE_SERVICE_ROLE_KEY; no usa anon key.
 * Si falta la key, devuelve null y se loguea un aviso.
 */
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    if (!url) {
      console.error("[Supabase] Falta NEXT_PUBLIC_SUPABASE_URL en el entorno. RAG y backend requieren esta variable.");
    }
    if (!key) {
      console.error(
        "[Supabase] Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (Vercel). El servidor usa SOLO service role; no uses anon key aquí."
      );
    }
    return null;
  }

  return createSupabaseClient<Database>(url, key);
}
```

---

## src/lib/supabase/client.ts (contenido completo)

Cliente Supabase para el navegador (anon key).

```typescript
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type { Database };

export function createClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient<Database>(url, key);
}
```

---

## src/lib/supabase/types.ts (contenido completo)

Tipos TypeScript de las tablas Supabase usadas por la app (consultas_diarias, faqs, usuarios_premium). Las tablas RAG (instruments, instrument_versions, instrument_chunks, sources, feedback, legal_audit_log) pueden no estar en este tipo; los scripts y route.ts usan clientes sin tipado estricto para esas tablas.

```typescript
export type Database = {
  public: {
    Tables: {
      consultas_diarias: {
        Row: { id: string; user_id: string; fecha: string; cantidad: number; created_at: string | null };
        Insert: { id?: string; user_id: string; fecha: string; cantidad?: number; created_at?: string | null };
        Update: { id?: string; user_id?: string; fecha?: string; cantidad?: number; created_at?: string | null };
        Relationships: [];
      };
      faqs: {
        Row: { id: string; category: string; question: string; answer: string; created_at: string };
        Insert: { id?: string; category: string; question: string; answer: string; created_at?: string };
        Update: { category?: string; question?: string; answer?: string; created_at?: string };
        Relationships: [];
      };
      usuarios_premium: {
        Row: { id: string; user_id: string; stripe_subscription_id: string | null; activo: boolean; created_at: string };
        Insert: { id?: string; user_id: string; stripe_subscription_id?: string | null; activo?: boolean; created_at?: string };
        Update: { user_id?: string; stripe_subscription_id?: string | null; activo?: boolean; created_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
```

---

## src/lib/reliability/judge.ts (contenido completo)

Legal Reliability Engine — juez que evalúa borrador de respuesta legal y devuelve decisión (APPROVE | REWRITE | NEED_MORE_INFO | HIGH_AMBIGUITY). Usado opcionalmente; el flujo principal de max-reliability en route.ts usa su propio prompt JSON y no llama a este juez.

```typescript
/**
 * Legal Reliability Engine v1 — Judge gate.
 * Evalúa borrador de respuesta legal y devuelve decisión estructurada.
 */
import type { ConstitutionCitation } from "@/lib/rag/constitution";

export type JudgeDecision =
  | "APPROVE"
  | "REWRITE"
  | "NEED_MORE_INFO"
  | "HIGH_AMBIGUITY";

export type JudgeResult = {
  decision: JudgeDecision;
  missing_info_questions: string[];
  risk_flags: string[];
  final_answer: string;
  confidence: number;
  caveats: string[];
  next_steps: string[];
  audit_summary: string;
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type EvaluateLegalAnswerParams = {
  user_query: string;
  draft_answer: string;
  citations: ConstitutionCitation[];
  mode: "standard" | "max-reliability";
  anthropicApiKey: string;
};

export async function evaluateLegalAnswer(params: EvaluateLegalAnswerParams): Promise<JudgeResult> {
  const { user_query, draft_answer, citations, anthropicApiKey } = params;
  const hasCitations = citations.length > 0;
  const citationBlock = hasCitations
    ? citations
        .map(
          (c) =>
            `- ${c.instrument} (${c.canonical_key}), publicada ${c.published_date}, fuente: ${c.source_url}`
        )
        .join("\n")
    : "(No se proporcionaron fuentes oficiales verificables)";

  const system = `Eres un juez de confiabilidad legal para respuestas informativas (República Dominicana). Tu salida DEBE ser ÚNICAMENTE un JSON válido...
Schema exacto: { "decision": "APPROVE" | "REWRITE" | "NEED_MORE_INFO" | "HIGH_AMBIGUITY", "missing_info_questions": [...], "risk_flags": [...], "final_answer": "...", "confidence": número, "caveats": [...], "next_steps": [...], "audit_summary": "..." }
Reglas obligatorias: Si NO hay citas y la consulta es legal => NEED_MORE_INFO o REWRITE; artículos sin cita => risk_flag + REWRITE; depende de hechos del usuario => NEED_MORE_INFO. APPROVE solo si respuesta sólida con fuentes.`;

  const user = `Consulta del usuario:\n${user_query}\n\nBorrador de respuesta a revisar:\n${draft_answer}\n\nFuentes proporcionadas:\n${citationBlock}\n\nDevuelve SOLO el JSON.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Judge API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const raw =
    (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;
  let result: Partial<JudgeResult>;
  try {
    result = JSON.parse(jsonStr) as Partial<JudgeResult>;
  } catch {
    return {
      decision: "REWRITE",
      missing_info_questions: [],
      risk_flags: ["No se pudo parsear la decisión del juez"],
      final_answer: draft_answer,
      confidence: 0.5,
      caveats: [],
      next_steps: [],
      audit_summary: "Error parseando respuesta del juez",
    };
  }

  return {
    decision: (result.decision as JudgeDecision) ?? "REWRITE",
    missing_info_questions: Array.isArray(result.missing_info_questions)
      ? result.missing_info_questions.filter((q) => typeof q === "string")
      : [],
    risk_flags: Array.isArray(result.risk_flags)
      ? result.risk_flags.filter((r) => typeof r === "string")
      : [],
    final_answer: typeof result.final_answer === "string" ? result.final_answer : draft_answer,
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    caveats: Array.isArray(result.caveats) ? result.caveats.filter((c) => typeof c === "string") : [],
    next_steps: Array.isArray(result.next_steps) ? result.next_steps.filter((s) => typeof s === "string") : [],
    audit_summary: typeof result.audit_summary === "string" ? result.audit_summary : "",
  };
}
```

---

## src/app/api/chat/route.ts (referencia y contenido)

Ruta POST que orquesta el chat: RAG (match_vigente_chunks), modos **normal** y **máxima confiabilidad**, clarify y (en modo normal) investigación con múltiples agentes (Claude, xAI, OpenAI, Groq, Gemini).  
**Archivo:** `src/app/api/chat/route.ts` (≈1240 líneas).  
**Export:** `POST(request: NextRequest): Promise<NextResponse>`.

**Imports principales:** `NextRequest`, `NextResponse`; `DISCLAIMER_PREFIX` desde `@/lib/chat-guardrails`; `embedQuery`, `retrieveVigenteChunks`, `retrieveVigenteChunksWithEmbedding`, `formatVigenteContext`, `formatMaxReliabilityContext`, `VigenteChunk` desde `@/lib/rag/vigente`; `getSupabaseServer` desde `@/lib/supabase/server`.

**Tipos y constantes relevantes:**
- `ChatHistoryMessage`, `RejectResponse`, `ClarifyResponse`, `AnswerResponse`, `ChatResponse`.
- `ADVERTENCIA_FINAL_EXACTA`, `DISCLAIMER_HARD_RULES`, `RAG_RESPONSE_STRUCTURE`, `BUSQUEDA_PROMPT`, `MAX_RELIABILITY_DISCLAIMER`.
- URLs: `XAI_URL`, `OPENAI_URL`, `GROQ_URL`, `GEMINI_PRIMARY_URL`, `GEMINI_FALLBACK_URL`, `ANTHROPIC_URL`.
- `MODELS`: xai, openai_primary/fallback, groq, claude_primary/fallback, gemini_primary/fallback.
- `RAG_TOP_K = 8`, `MAX_RELIABILITY_AGENT_TIMEOUT_MS = 25000`, `MR_TOP_K = 5`, `MR_MAX_CTX_CHARS = 7500`, `MR_MAX_TOKENS = 1600`.

**Helpers internos (no exportados):**
- `normalizeText`, `truncate`, `searchOfficialSourcesRD` (Serper), `needsClarificationHeuristic`, `fetchJsonOrText`.
- `callOpenAIStyle`, `callGemini`, `callGeminiWithFallback`, `withTimeout` (AbortController), `callClaude`, `callClaudeWithFallback`.
- `formatHistory`, `safeJsonParse`, `extractJson`, `extractArticleMentions`, `getUnverifiedArticleMentions`, `stripUnverifiedArticlesAndAddCaveat`.

**Flujo POST (resumido):**
1. Parsea `body.message`, `body.history`, `body.mode`. Normaliza modo: `rawMode`, `modeNorm`, `isMax` (aliases: max-reliability, max, máxima-confiabilidad, maxima-confiabilidad, etc.).
2. RAG: `retrieveVigenteChunks(message, RAG_TOP_K)` → `chunks`, `ragContext = formatVigenteContext(chunks)`, `ragBlock` para modo normal.
3. **Si isMax (máxima confiabilidad):**
   - Sin chunks → `type: "clarify"` con 3 preguntas y log a `legal_audit_log`.
   - Con chunks → `mrChunks = chunks.slice(0, MR_TOP_K)`, `formatMaxReliabilityContext(mrChunks, MR_MAX_CTX_CHARS)`, prompt JSON estricto, `withTimeout(callClaudeWithFallback(..., signal), MAX_RELIABILITY_AGENT_TIMEOUT_MS)`. Si timeout → retry con contexto 4000 chars y max_tokens 1200; si falla → fallback OpenAI gpt-4o-mini. Parsea JSON → `decision`, `answer`, `citations`, etc. Si `decision === "NEED_MORE_INFO"` → `type: "clarify"` con hasta 3 preguntas. Post-check: `stripUnverifiedArticlesAndAddCaveat(answer, allChunkText)`. Fuentes desde `fuentesToShow` (citations del modelo o desde mrChunks). Respuesta: `type: "answer"`, `content` con disclaimer y sección **Fuentes**.
4. **Modo normal sin chunks:** orientación en 5 bullets + nota “no encontré fuentes vigentes” + sugerir Máxima Confiabilidad.
5. **Modo normal con posible clarify:** `needsClarificationHeuristic(message)` → clarificador Claude → `type: "clarify"` con preguntas.
6. **Modo normal investigación:** tema, `ragBlock`, llamadas en paralelo a Claude, xAI, OpenAI, Groq, Gemini; síntesis y post-check de artículos; respuesta `type: "answer"` con `content` y opcionalmente **Fuentes** desde `ragContext.citations`.

**Body esperado:** `{ message: string, history?: ChatHistoryMessage[], userId?: string | null, mode?: string }`.  
**Respuestas:** `{ type: "reject", message }` (400/503), `{ type: "clarify", questions: string[] }` (200), `{ type: "answer", content: string, note?: string, ... }` (200).

El **código fuente completo** del archivo está en `src/app/api/chat/route.ts`. Al modificar ese archivo, actualizar esta sección (flujo, constantes, helpers) para que el documento siga siendo la referencia única.

---

## src/app/api/feedback/route.ts (contenido completo)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      query?: string;
      response?: string;
      feedback?: string;
      timestamp?: string;
      mode?: string;
      userId?: string | null;
    };

    const query = typeof body.query === "string" ? body.query : "";
    const response = typeof body.response === "string" ? body.response : "";
    const feedback = typeof body.feedback === "string" ? body.feedback : "";
    const createdAt = typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();
    const mode = typeof body.mode === "string" ? body.mode : "standard";
    const userId = typeof body.userId === "string" ? body.userId : null;

    const supabase = getSupabaseServer();
    if (supabase) {
      await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<{ error: unknown }> } }).from(
        "feedback"
      ).insert({
        query,
        response,
        feedback,
        created_at: createdAt,
        mode,
        user_id: userId,
      });
    }

    return NextResponse.json(
      { message: "Feedback recibido, gracias por ayudar a mejorar" },
      { status: 200 }
    );
  } catch (err) {
    console.error("[feedback]", err);
    return NextResponse.json(
      { message: "Error al guardar el feedback" },
      { status: 500 }
    );
  }
}
```

---

## src/app/api/consultas-limit/route.ts (contenido completo)

GET: límite freemium (permitido, usadas, limite). POST: incrementa contador de consultas para userId.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

const LIMITE_GRATIS = 5;

export async function GET(request: NextRequest) {
  const HOY = new Date().toISOString().split("T")[0];
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: LIMITE_GRATIS });
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: LIMITE_GRATIS });
  }

  const { data: premium } = await supabase
    .from("usuarios_premium")
    .select("id")
    .eq("user_id", userId)
    .eq("activo", true)
    .maybeSingle();

  if (premium) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: -1 });
  }

  const { data: row } = await supabase
    .from("consultas_diarias")
    .select("cantidad")
    .eq("user_id", userId)
    .eq("fecha", HOY)
    .maybeSingle();

  const usadas = (row as { cantidad?: number } | null)?.cantidad ?? 0;
  const permitido = usadas < LIMITE_GRATIS;

  return NextResponse.json({
    permitido,
    usadas,
    limite: LIMITE_GRATIS,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Falta userId" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ ok: true });
  }

  const today = new Date().toISOString().split("T")[0];
  const { data: existing } = await supabase
    .from("consultas_diarias")
    .select("id, cantidad")
    .eq("user_id", userId)
    .eq("fecha", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("consultas_diarias")
      .update({ cantidad: (existing.cantidad ?? 0) + 1 })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("consultas_diarias")
      .insert({ user_id: userId, fecha: today, cantidad: 1 });
  }

  return NextResponse.json({ ok: true });
}
```

---

## src/app/api/env-check/route.ts (contenido completo)

```typescript
import { NextResponse } from "next/server";

function present(v: string | undefined) {
  return typeof v === "string" && v.length > 0;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let urlHost: string | null = null;
  if (url) {
    try {
      urlHost = new URL(url).host;
    } catch {
      urlHost = null;
    }
  }

  return NextResponse.json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: present(url),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: present(anon),
      SUPABASE_SERVICE_ROLE_KEY: present(service),
      urlHost,
    },
  });
}
```

---

### scripts/verify_rag_rpc.ts

Verifica que:
- exista la función `match_vigente_chunks` en Supabase
- exista al menos un chunk vigente con embedding
- el RPC devuelva filas usando un embedding real (no vector de ceros)

**Uso:** `npm run verify:rag`  
**Requisitos:** `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Si falla por falta de chunks/embedding, ejecutar antes ingest (ej. `npm run ingest:manual -- --all`).

---

## 1. scripts/ingest_constitucion.ts

Ingesta piloto: Constitución de la República Dominicana desde PDF (local o URL).  
**Uso:** `npm run ingest:constitucion`  
**Requisitos:** `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Opcional: `CONSTITUCION_SOURCE_URL`, `CONSTITUCION_PUBLISHED_DATE`.

```typescript
/**
 * Ingesta piloto: Constitución RD.
 * Uso: npm run ingest:constitucion (o npx tsx scripts/ingest_constitucion.ts)
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";
const CONSTITUCION_CANONICAL_KEY = "CONSTITUCION-RD";

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }
  return chunks;
}

async function getPdfText(): Promise<string> {
  const url = process.env.CONSTITUCION_SOURCE_URL;
  const localPath = join(process.cwd(), "documents", "constitucion", "constitucion.pdf");

  if (existsSync(localPath)) {
    const pdfParse = (await import("pdf-parse")).default;
    const dataBuffer = readFileSync(localPath);
    const data = await pdfParse(dataBuffer);
    return data?.text ?? "";
  }

  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch PDF failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(Buffer.from(arrayBuffer));
    return data?.text ?? "";
  }

  throw new Error(
    "No PDF source. Coloca documents/constitucion/constitucion.pdf o define CONSTITUCION_SOURCE_URL en .env.local"
  );
}

async function getEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return r.data[0]?.embedding ?? [];
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  if (!openaiKey) {
    console.error("Falta OPENAI_API_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey) as SupabaseClient;
  const openai = new OpenAI({ apiKey: openaiKey });

  console.log("Extrayendo texto del PDF...");
  let rawText: string;
  try {
    rawText = await getPdfText();
  } catch (e) {
    console.error("Error extrayendo PDF:", e);
    process.exit(1);
  }

  const contentText = normalizeText(rawText);
  const contentHash = sha256(contentText);
  const publishedDate =
    process.env.CONSTITUCION_PUBLISHED_DATE || new Date().toISOString().slice(0, 10);
  const sourceUrl = process.env.CONSTITUCION_SOURCE_URL || "local-file";

  console.log("Source e instrument...");
  let finalSourceId: string | null = null;
  const { data: existingSource } = await supabase
    .from("sources")
    .select("id")
    .eq("base_url", sourceUrl)
    .limit(1)
    .maybeSingle();
  if (existingSource?.id) {
    finalSourceId = existingSource.id;
  } else {
    const { data: inserted } = await supabase
      .from("sources")
      .insert({ name: "Constitución RD (fuente inicial)", base_url: sourceUrl })
      .select("id")
      .single();
    finalSourceId = inserted?.id ?? null;
  }

  const { data: instrument } = await supabase
    .from("instruments")
    .select("id")
    .eq("canonical_key", CONSTITUCION_CANONICAL_KEY)
    .maybeSingle();
  let instrumentId = instrument?.id;
  if (!instrumentId) {
    const { data: inserted } = await supabase
      .from("instruments")
      .insert({
        canonical_key: CONSTITUCION_CANONICAL_KEY,
        type: "constitucion",
        number: null,
        title: "Constitución de la República Dominicana",
      })
      .select("id")
      .single();
    instrumentId = inserted?.id ?? null;
  }
  if (!instrumentId) throw new Error("Instrument CONSTITUCION-RD no encontrado");

  const { data: existingVersion } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("content_hash", contentHash)
    .maybeSingle();

  let versionId: string;
  if (existingVersion?.id) {
    console.log("Versión con mismo content_hash ya existe, reutilizando.");
    versionId = existingVersion.id;
  } else {
    await supabase
      .from("instrument_versions")
      .update({ status: "DEROGADA" })
      .eq("instrument_id", instrumentId)
      .eq("status", "VIGENTE");

    const { data: newVersion, error: verErr } = await supabase
      .from("instrument_versions")
      .insert({
        instrument_id: instrumentId,
        source_id: finalSourceId,
        published_date: publishedDate,
        effective_date: null,
        status: "VIGENTE",
        source_url: sourceUrl,
        gazette_ref: null,
        content_text: contentText,
        content_hash: contentHash,
      })
      .select("id")
      .single();

    if (verErr || !newVersion?.id) {
      console.error("Error insertando instrument_version:", verErr);
      process.exit(1);
    }
    versionId = newVersion.id;
  }

  const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`Generando embeddings para ${chunks.length} chunks...`);

  const existingChunks = await supabase
    .from("instrument_chunks")
    .select("id")
    .eq("instrument_version_id", versionId);
  if (existingChunks.data && existingChunks.data.length > 0) {
    console.log("Chunks ya existen para esta versión. Eliminando y reinsertando.");
    await supabase.from("instrument_chunks").delete().eq("instrument_version_id", versionId);
  }

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(openai, chunks[i]);
    await supabase.from("instrument_chunks").insert({
      instrument_version_id: versionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${chunks.length}`);
  }

  console.log("Ingesta finalizada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## 2. scripts/ingest_manual.ts

Ingesta manual en batch desde archivos TXT para el corpus legal (RAG). Deriva `canonical_key`, título y tipo desde la ruta del archivo (ej. `documents/Ley 41-08/41-08.txt` → LEY-41-08, Ley 41-08).

**Uso:**
- `npm run ingest:manual -- --all` — ingesta todos los `.txt` bajo `documents/`.
- `npm run ingest:manual -- --files "documents/constitucion/constitucion.txt,documents/Ley 41-08/41-08.txt"` — lista de rutas separadas por coma.
- `npm run ingest:manual -- --all --published 2010-01-26 --source_url "https://consultoria.gov.do/"` — con opciones.

**Opciones:**
- `--all` — todos los .txt en `documents/`.
- `--files "path1,path2"` — rutas separadas por coma.
- `--published YYYY-MM-DD` — fecha de promulgación (default: hoy).
- `--source_url URL` — URL de la fuente (default: `"manual-ingest"`).
- `--status VIGENTE` — status de la versión (default: VIGENTE).

**Requisitos:** `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` en `.env.local`.

**Código:** Ver `scripts/ingest_manual.ts`. Al modificar ese archivo, actualizar esta sección.

---

## 3. scripts/crawl_consultoria.ts

Crawl selectivo de consultoria.gov.do usando la API de Firecrawl. Inicia el crawl en `https://www.consultoria.gov.do/consulta/` con límite de páginas; filtra solo URLs que contengan ley, decreto, resolución o constitución; por cada documento deriva `canonical_key` y tipo desde el título; compara hash de contenido y, si es nuevo o cambió, crea/actualiza instrument_version VIGENTE e inserta chunks con embeddings (OpenAI text-embedding-3-small).

**Uso:** `npm run crawl:consultoria`

**Requisitos:** `FIRECRAWL_API_KEY`, `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` en `.env.local`.

**Parámetros internos (en el script):** `CRAWL_LIMIT = 20`, `CHUNK_SIZE = 1000`, `CHUNK_OVERLAP = 150`, `EMBEDDING_MODEL = "text-embedding-3-small"`.

**Código:** Ver `scripts/crawl_consultoria.ts`. Al modificar ese archivo, actualizar esta sección.

---

## DEPLOY.md (contenido completo)

```markdown
# DEPLOY.md - Cómo actualizar InfoLegalRD en Vercel (sin crear proyecto nuevo)

## Pasos para redeployar después de cualquier cambio

1. Commit y push a GitHub (en la terminal de Cursor):
   git add .
   git commit -m "Cambios nuevos: [describe brevemente]"
   git push origin main

2. Ve a https://vercel.com/dashboard
3. Selecciona tu proyecto actual (infolegalrd o infollegalrd-iu6d, el que tiene tu repo conectado).
4. Ve a la pestaña Deployments.
5. Busca el último deploy → haz clic en Redeploy (botón con flecha circular).
6. Espera 1–3 minutos hasta que diga "Ready" o "Success".
7. El link público se actualiza automáticamente (ej. https://infolegalrd.vercel.app).

## Si es la primera vez o Vercel pide configuración:
- Asegúrate de que el proyecto esté conectado a Mannyaxo/infolegalrd (Settings → Git).
- Añade Environment Variables en Settings → Environment Variables (si no están):
  - XAI_API_KEY = [tu valor]
  - GEMINI_API_KEY = [tu valor]
  - OPENAI_API_KEY = [tu valor]
  - ANTHROPIC_API_KEY = [tu valor]
  - GROQ_API_KEY = [opcional]
- Redeploy después de añadirlas.

Tips:
- Node version: Vercel usa 24.x automáticamente con "engines" en package.json.
- Si hay error, revisa logs en Deployments → Build Logs.
```

---

## README.md (contenido completo)

```markdown
# InfoLegal RD

Aplicación web **informativa** sobre consultas legales en República Dominicana. Enfoque 100 % educativo; no sustituye asesoría legal profesional.

## Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Base de datos y auth**: Supabase
- **Chatbot**: OpenAI API (respuestas estructuradas con disclaimers)
- **Deploy**: Vercel

## Características

- Página de inicio con disclaimer visible
- Chatbot con respuestas en 5 bloques: Resumen, Normativa, Análisis, Recomendaciones, Advertencia
- FAQs precargadas (laboral, civil); opcionalmente desde Supabase
- Login/registro con Supabase Auth (freemium: 5 consultas/día; premium ilimitado con Stripe)
- Plantillas descargables (ej. Acuerdo de Terminación de Colaboración Independiente)
- Diseño responsive

## Desarrollo local

npm install
cp .env.example .env.local   # Rellena NEXT_PUBLIC_SUPABASE_*, OPENAI_API_KEY
npm run dev

Abre [http://localhost:3000](http://localhost:3000).

## Ingesta de leyes (RAG)

Para cargar normativa desde archivos TXT o desde consultoria.gov.do, ver **docs/INGESTA_LEYES.md**. Resumen:

- **Ingesta manual (batch):** `npm run ingest:manual -- --all` o `--files "path1,path2"`
- **Crawler consultoria.gov.do:** `npm run crawl:consultoria` (requiere `FIRECRAWL_API_KEY` en `.env.local`)

## Despliegue en Vercel

Ver **DEPLOY.md** para: variables de entorno en Vercel, deploy, Redeploy.

### Checklist: variables de entorno en producción

- **`.env.local`** solo se usa en desarrollo local; Vercel **no** lo lee.
- En Vercel: **Project → Settings → Environment Variables** define las variables para **Production**, **Preview** y/o **Development**.
- **RAG (consultas con base legal):** debe estar configurada **SUPABASE_SERVICE_ROLE_KEY** en el entorno (Vercel). Si falta, el backend no puede ejecutar `match_vigente_chunks` y las consultas devolverán "sin fuentes". Configure esta variable en Production / Preview / Development.
- Después de añadir o cambiar variables en Vercel, hay que **Redeploy** (Deployments → Redeploy) o hacer **push** de un nuevo commit para que se apliquen.
- Para comprobar que las variables están disponibles en producción, abre **`https://tu-dominio.vercel.app/api/env-check`** y revisa que los valores `env.*` sean `true`.

## Aviso legal

Toda la información de la aplicación es **general y orientativa**. No constituye asesoramiento legal vinculante ni crea relación abogado-cliente. Siempre se debe consultar a un abogado colegiado para el caso específico.
```

---

## Cómo abrir este documento en Word

1. Abre **Microsoft Word**.
2. Archivo → **Abrir** → selecciona **docs/SCRIPTS_INFOLEGAL_RD.md**.
3. Word abrirá el Markdown; puedes dar formato si lo deseas.
4. Archivo → **Guardar como** → elige formato **Documento de Word (.docx)**.

---

## Resumen y regla de actualización

Este documento es la **referencia única** de todo lo que usa InfoLegal RD: scripts (`scripts/*.ts`), rutas API (`src/app/api/**/route.ts`), variables de entorno, estructura de archivos (lib, componentes, Supabase) y migraciones.  
**Cada vez que hagas un cambio** en scripts, APIs, env, migraciones o estructura relevante, **actualiza la sección correspondiente** de este archivo para que siga siendo la fuente de verdad.
