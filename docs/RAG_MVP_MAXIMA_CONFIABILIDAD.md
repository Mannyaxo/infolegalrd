# RAG MVP – Máxima Confiabilidad

Ingesta manual de documentos y uso en el chat (modo max-reliability) con las tablas ya creadas en Supabase: `sources`, `instruments`, `instrument_versions`, `instrument_chunks`, `legal_audit_log`.

---

## 1) Cómo correr la ingesta manual

### Variables de entorno

En `.env.local` (o en el entorno donde ejecutes el script):

- `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

### Ejemplo listo de ejecución (Constitución RD)

1. Crea un archivo de texto con el contenido de la Constitución (o el documento que quieras), por ejemplo:
   - `docs/constitucion.txt`

2. Desde la raíz del proyecto:

```bash
npm run ingest:manual -- --type constitucion --canonical CONSTITUCION-RD --title "Constitución RD" --published 2010-01-26 --status VIGENTE --source_url "https://www.constitucion.gob.do" --file "./docs/constitucion.txt"
```

O con `npx tsx`:

```bash
npx tsx scripts/ingest_manual.ts --type constitucion --canonical CONSTITUCION-RD --title "Constitución RD" --published 2010-01-26 --status VIGENTE --source_url "https://www.constitucion.gob.do" --file "./docs/constitucion.txt"
```

### Parámetros del script

| Parámetro      | Obligatorio | Descripción                                      |
|----------------|-------------|--------------------------------------------------|
| `--file`       | Sí          | Ruta al archivo .txt con el contenido            |
| `--type`       | No          | Tipo de instrumento (default: constitucion)      |
| `--canonical`  | No          | Clave canónica (default: CONSTITUCION-RD)        |
| `--title`      | No          | Título del instrumento                           |
| `--published`  | No          | Fecha publicación YYYY-MM-DD (default: hoy)      |
| `--status`     | No          | VIGENTE / DEROGADA / PARCIAL (default: VIGENTE)  |
| `--source_url` | No          | URL de la fuente (default: manual://)            |
| `--number`     | No          | Número del instrumento                           |
| `--gazette_ref`| No          | Referencia gaceta                                 |
| `--effective`  | No          | Fecha efectividad YYYY-MM-DD                     |

El script:

- Inserta/usa la fuente `ManualUpload` con `base_url` `manual://`.
- Inserta/actualiza el instrumento por `canonical_key`.
- Inserta una nueva versión (o reutiliza si el `content_hash` ya existe).
- Hace chunking (~1000 caracteres, overlap 150), genera embeddings con OpenAI y guarda en `instrument_chunks`.

---

## 2) Cómo probar una consulta (modo Máxima Confiabilidad)

1. Aplicar la migración que añade la función `match_vigente_chunks` (si no está aplicada):
   - Archivo: `supabase/migrations/20250223100000_match_vigente_chunks.sql`
   - En el SQL Editor de Supabase: ejecutar su contenido.

2. Arrancar la app:
   ```bash
   npm run dev
   ```

3. En la UI del chat, activar **Modo Máxima Confiabilidad**.

4. Hacer una pregunta que toque el contenido ingerido (por ejemplo sobre la Constitución):
   - "¿Qué dice la Constitución sobre la nacionalidad?"
   - "¿Cuáles son los derechos fundamentales?"

5. Comprobar en la respuesta:
   - Que usa el contexto RAG (citas al texto ingerido).
   - Al final, sección **Fuentes (Citations)** con: título, source_url, published_date, status.
   - Confidence, Caveats y Next steps (según el juez).

6. Comprobar auditoría en Supabase:
   ```sql
   SELECT created_at, mode, query, decision, confidence, citations, model_used
   FROM legal_audit_log
   ORDER BY created_at DESC
   LIMIT 5;
   ```

El modo **standard** no cambia de comportamiento; solo el modo **max-reliability** usa RAG (topK=6 chunks vigentes) y escribe en `legal_audit_log` con las citas.

---

## Resumen de archivos

| Archivo | Descripción |
|---------|-------------|
| `scripts/ingest_manual.ts` | Script de ingesta manual (source, instrument, version, chunks + embeddings). |
| `supabase/migrations/20250223100000_match_vigente_chunks.sql` | Función RPC para búsqueda por similitud en todos los instrumentos VIGENTES. |
| `src/lib/rag/vigente.ts` | `retrieveVigenteChunks`, `formatVigenteContext` (citas con title, source_url, published_date, status). |
| `src/app/api/chat/route.ts` | En `mode=max-reliability`: RAG con topK=6, contexto con metadata, respuesta con Fuentes/Citations, registro en `legal_audit_log` (citations, model_used, tokens_in/out en null si no hay). |

No se ha cambiado la UI. Todo compila con Next.js 14.
