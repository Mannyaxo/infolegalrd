# Scripts y referencia técnica — InfoLegal RD

**Documento maestro del proyecto.** Incluye scripts, APIs, variables de entorno y estructura.  
Abrir en **Word**: Archivo → Abrir → este .md → Guardar como .docx.

> **MANTENER ACTUALIZADO:** Siempre que se modifiquen scripts (`scripts/*.ts`), rutas API (`src/app/api/**/route.ts`), variables de entorno o la estructura del proyecto, actualizar este documento para que refleje los cambios.

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
| `FIRECRAWL_API_KEY` | Crawler consultoria.gov.do | Solo para crawl |
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

---

## Rutas API (src/app/api)

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/chat` | POST | Orquestador del chat: RAG (match_vigente_chunks), modos normal y máxima confiabilidad, clarificar, síntesis. Body: `message`, `history`, `userId`, `mode`. El backend acepta aliases de modo: `max-reliability`, `max`, `máxima-confiabilidad`, `maxima`, `alta-confiabilidad`, etc. (se normalizan a isMax para entrar al flujo max-reliability). |
| `/api/feedback` | POST | Guarda feedback de usuario. Body: `query`, `response`, `feedback`, `timestamp`, `mode`, `userId`. Tabla Supabase: `feedback` (migración `20250222120000_feedback.sql`: columnas `id`, `query`, `response`, `feedback`, `created_at`, `user_id`, `mode`). |
| `/api/consultas-limit` | GET | Límite freemium. Query: `userId` (opcional). Respuesta: `{ permitido: boolean, usadas: number, limite: number }`. Si falta `userId` devuelve permitido true, usadas 0, limite 5. |
| `/api/consultas-limit` | POST | Incrementa contador de consultas. Body: `{ userId: string }`. Respuesta: `{ ok: boolean }`. |
| `/api/env-check` | GET | Comprueba que existan variables de entorno (sin mostrar valores). |

---

## Estructura de archivos clave

- `scripts/` — ingest_constitucion.ts, ingest_manual.ts, crawl_consultoria.ts, verify_rag_rpc.ts
- `src/app/api/chat/route.ts` — Orquestador chat + RAG
- `src/app/api/feedback/route.ts` — POST feedback
- `src/lib/supabase/server.ts` — getSupabaseServer() (solo SERVICE_ROLE_KEY)
- `src/lib/rag/vigente.ts` — retrieveVigenteChunks, formatVigenteContext, match_vigente_chunks RPC
- `src/lib/rag/embeddings.ts` — getEmbedding (OpenAI)
- `src/components/chat/QueryPanel.tsx` — Panel de consulta en la home + feedback
- `supabase/migrations/` — SQL (instrumentos, match_vigente_chunks, feedback, hierarchy_level)

**Otros documentos:** `docs/INGESTA_LEYES.md` (cómo ingestar y verificar), `docs/INFORME_PROYECTO_INFOLEGAL_RD.md` (informe para traspaso/IA).

---

### scripts/verify_rag_rpc.ts

Verifica que:
- exista la función `match_vigente_chunks` en Supabase
- exista al menos un chunk vigente con embedding
- el RPC devuelva filas usando un embedding real (no vector de ceros)

**Uso:** `npm run verify:rag`

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

Ingesta manual en batch desde archivos TXT. Soporta `--all` (todos los .txt en `documents/`) o `--files "path1,path2"`. Deriva `canonical_key` y título desde la ruta.  
**Uso:** `npm run ingest:manual -- --all` o `npm run ingest:manual -- --files "documents/constitucion/constitucion.txt"`  
**Opciones:** `--published`, `--source_url`, `--status`.  
**Requisitos:** `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

**Código:** Ver y copiar desde `scripts/ingest_manual.ts`. Al modificar ese archivo, actualizar esta sección o el bloque de código en este documento para que siga reflejando el contenido actual.

---

## 3. scripts/crawl_consultoria.ts

Crawl selectivo de consultoria.gov.do con Firecrawl API. Filtra URLs con ley/decreto/resolución/constitución, deriva canonical_key desde el título, compara hash y crea nuevas versiones VIGENTE + chunks con embeddings.  
**Uso:** `npm run crawl:consultoria`  
**Requisitos:** `FIRECRAWL_API_KEY`, `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

**Código:** Ver y copiar desde `scripts/crawl_consultoria.ts`. Al modificar ese archivo, actualizar esta sección o el bloque de código en este documento para que siga reflejando el contenido actual.

---

## Cómo abrir este documento en Word

1. Abre **Microsoft Word**.
2. Archivo → **Abrir** → selecciona **docs/SCRIPTS_INFOLEGAL_RD.md**.
3. Word abrirá el Markdown; puedes dar formato si lo deseas.
4. Archivo → **Guardar como** → elige formato **Documento de Word (.docx)**.

**Resumen:** Este documento contiene la referencia completa del proyecto (env, npm, APIs, estructura, script ingest_constitucion completo). Los scripts ingest_manual y crawl_consultoria están en `scripts/`; al cambiar cualquier script o API, actualizar este documento para que siga siendo la fuente única de verdad.
