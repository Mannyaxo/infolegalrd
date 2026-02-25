# Legal Reliability Engine v1 + RAG (Piloto Constitución RD)

## Resumen

- **RAG**: contexto oficial desde la Constitución RD (versión vigente en Supabase).
- **Judge gate**: el modo Máxima Confiabilidad ya usa un juez; se le inyecta contexto RAG y se añaden Fuentes/Versión en la respuesta.
- **Auditoría**: cada request en modo max-reliability se registra en `legal_audit_log`.

No se modifica el flujo estándar ni la UI; solo se añade un paso RAG opcional y sección de fuentes cuando hay citas.

---

## 1) Variables de entorno

En `.env.local` (local) o en Vercel (Production/Preview):

| Variable | Uso |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave con permisos para RAG y `legal_audit_log` |
| `OPENAI_API_KEY` | Embeddings (RAG) y agentes existentes |
| `CONSTITUCION_PUBLISHED_DATE` | (Opcional) Fecha de publicación de la Constitución, formato `YYYY-MM-DD`. Por defecto: hoy. |
| `CONSTITUCION_SOURCE_URL` | (Opcional) URL del PDF de la Constitución si no se usa archivo local. |

Para el **script de ingesta** (solo local):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- Opcional: `CONSTITUCION_SOURCE_URL` o archivo local (ver abajo).

---

## 2) Migración en Supabase

1. En el **SQL Editor** de Supabase, ejecuta el contenido de:
   - `supabase/migrations/20250222100000_legal_reliability_engine.sql`
2. O, si usas Supabase CLI: `supabase db push`.

Eso crea:

- `sources`, `instruments`, `instrument_versions`, `instrument_chunks` (con extensión `vector` e índice ivfflat).
- Función RPC `match_constitution_chunks(query_embedding, match_count)`.
- Tabla `legal_audit_log` y políticas RLS.

Si la extensión `vector` no está habilitada en tu proyecto, actívala en **Database → Extensions → vector**.

---

## 3) Ingesta piloto: Constitución RD

**Opción A — Archivo local (recomendado)**

1. Coloca el PDF en:  
   `documents/constitucion/constitucion.pdf`
2. Instala dependencias e ingesta:

```bash
npm install
npm run ingest:constitucion
```

**Opción B — URL**

1. En `.env.local` define:
   - `CONSTITUCION_SOURCE_URL=https://url-oficial-del-pdf.pdf`
2. Ejecuta:

```bash
npm run ingest:constitucion
```

El script:

- Extrae texto del PDF (local o URL).
- Normaliza texto y calcula `content_hash` (sha256).
- Crea/usa `sources` e `instruments` (Constitución RD).
- Inserta o reutiliza `instrument_versions` (evita duplicar por `content_hash`; marca como VIGENTE y deroga la anterior si aplica).
- Trocea el texto (~1200 caracteres, 150 de solape), genera embeddings con OpenAI e inserta en `instrument_chunks`.

Si falta `OPENAI_API_KEY` o Supabase, el script termina con error claro.

---

## 4) Verificar en Supabase

Después de la ingesta:

1. **instruments**: una fila con `canonical_key = 'CONSTITUCION-RD'`.
2. **instrument_versions**: al menos una fila con `status = 'VIGENTE'` y `content_text` no nulo.
3. **instrument_chunks**: filas con `chunk_index`, `chunk_text` y `embedding` no nulo.

En SQL:

```sql
SELECT id, canonical_key, title FROM instruments WHERE canonical_key = 'CONSTITUCION-RD';
SELECT id, published_date, status, left(content_text, 200) FROM instrument_versions WHERE status = 'VIGENTE';
SELECT count(*) FROM instrument_chunks;
```

---

## 5) Probar pregunta y ver citas/versión

1. Arranca la app: `npm run dev`.
2. Activa **Modo Máxima Confiabilidad** en el chat.
3. Pregunta algo que toque la Constitución (por ejemplo: “¿Qué dice la Constitución sobre la nacionalidad?”).
4. En la respuesta deberías ver:
   - Contenido que puede usar el contexto RAG.
   - Al final, sección **Fuentes:** con `source_url` y **Versión usada:** con `published_date` (si hay cita RAG).

En modo **Normal** (estándar) el mismo flujo usa el mismo contexto RAG en el prompt y, si hay cita, añade también la sección Fuentes/Versión al final.

Para comprobar el log de auditoría (solo max-reliability):

```sql
SELECT created_at, mode, decision, confidence, citations FROM legal_audit_log ORDER BY created_at DESC LIMIT 5;
```

---

## Archivos tocados (resumen)

| Área | Archivos |
|------|----------|
| **SQL** | `supabase/migrations/20250222100000_legal_reliability_engine.sql` (nuevo) |
| **Script ingesta** | `scripts/ingest_constitucion.ts` (nuevo) |
| **RAG** | `src/lib/rag/embeddings.ts`, `src/lib/rag/constitution.ts` (nuevos) |
| **Judge** | `src/lib/reliability/judge.ts` (nuevo; no usado aún en la ruta, reservado para futura integración explícita) |
| **API chat** | `src/app/api/chat/route.ts` (imports RAG + getSupabaseServer; contexto RAG en advocate/judge y en baseUser; Fuentes/Versión en respuesta; inserción en `legal_audit_log` en max-reliability) |
| **Deps** | `package.json` (pdf-parse, dotenv, tsx, script `ingest:constitucion`) |
| **Docs** | `docs/LEGAL_RELIABILITY_ENGINE.md` (este archivo), `documents/constitucion/.gitkeep` |

No se ha tocado UI ni el comportamiento existente de los modos; solo se añade contexto RAG, sección de fuentes y auditoría.
