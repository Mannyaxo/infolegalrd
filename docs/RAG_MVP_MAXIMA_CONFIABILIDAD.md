# RAG MVP – Máxima Confiabilidad

Ingesta manual de documentos y uso en el chat (modo max-reliability) con las tablas ya creadas en Supabase: `sources`, `instruments`, `instrument_versions`, `instrument_chunks`, `legal_audit_log`.

---

## 1) Cómo correr la ingesta manual

### Variables de entorno

En `.env.local` (o en el entorno donde ejecutes el script):

- `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

### Ejemplo listo de ejecución (Constitución RD: 2010 + reforma 2024)

- `published` = fecha de promulgación (Constitución RD: **2010-01-26**).
- `--effective` opcional = fecha de efectividad del texto consolidado (ej. reforma 2024: **2024-01-01** o la fecha real cuando la tengas; si no se pasa, effective_date queda null).
- `title` puede incluir "(texto consolidado 2024)".

1. Crea un archivo de texto con el contenido de la Constitución (o el documento que quieras), por ejemplo:
   - `documents/constitucion/constitucion.txt`

2. Desde la raíz del proyecto:

```bash
npm run ingest:manual -- --type constitucion --canonical CONSTITUCION-RD --title "Constitución de la República Dominicana (texto consolidado 2024)" --published 2010-01-26 --effective 2024-01-01 --status VIGENTE --source_url "https://www.consultoria.gov.do/" --file "./documents/constitucion/constitucion.txt"
```

O con `npx tsx`:

```bash
npx tsx scripts/ingest_manual.ts --type constitucion --canonical CONSTITUCION-RD --title "Constitución de la República Dominicana (texto consolidado 2024)" --published 2010-01-26 --effective 2024-01-01 --status VIGENTE --source_url "https://www.consultoria.gov.do/" --file "./documents/constitucion/constitucion.txt"
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

## 3) Pruebas manuales (blindaje anti-alucinación)

1. **Sin chunks (0 resultados RAG)**  
   - Con la base vacía de `instrument_chunks` (o sin instrumentos VIGENTES), envía una consulta en modo max-reliability.  
   - **Esperado:** Respuesta con `decision: "NO_EVIDENCE"`, mensaje indicando que no hay fuentes vigentes cargadas, `citations: []`, y registro en `legal_audit_log` sin llamada al modelo.

2. **Con chunks (evidencia suficiente)**  
   - Tras ingestar un instrumento (p. ej. Constitución), haz una pregunta que esté cubierta por el texto (p. ej. nacionalidad, derechos).  
   - **Esperado:** Respuesta con `decision: "APPROVE"` o `"NEED_MORE_INFO"`, citas con `title`, `source_url`, `published_date`, `status`, y sección **Fuentes (Citations)** al final.

3. **Intento de inventar Art. X**  
   - Pregunta algo que pueda llevar al modelo a citar un artículo que no existe en los chunks (o reformula una respuesta que mencione “Art. 15” cuando en el texto ingerido no aparece ese número).  
   - **Esperado:** El post-check detecta la mención y devuelve `decision: "NO_EVIDENCE"`, mensaje indicando que la respuesta incluía referencias no presentes en las fuentes, `citations: []`, y caveats/next_steps orientando a reformular o ingestar el instrumento correcto.

---

## 4) Checklist: metadata no alucinada (modo normal y max-reliability)

- **Gaceta Oficial / fechas de promulgación**  
  - Pregunta: *"¿Cuál es la Gaceta Oficial de la Constitución?"* (o *"¿En qué fecha se promulgó?"*).  
  - Si **no** está en los chunks ni en la metadata ingerida (published_date, effective_date, source_url, gazette_ref): la respuesta debe indicar **"no consta en el material recuperado"** (o equivalente) y no inventar número de Gaceta ni fecha.  
  - Si **sí** está en metadata (p. ej. gazette_ref o published_date en la versión): el modelo puede mencionarla citando que proviene de los metadatos del sistema.

- **Cita a Art. 69 (debido proceso)**  
  - Pregunta: *"¿Qué dice la Constitución sobre el debido proceso?"*  
  - Si el texto ingerido **contiene** el Art. 69 en los chunks recuperados: la respuesta puede citar Art. 69.  
  - Si **no** hay chunk con ese artículo: la respuesta no debe citar Art. 69 ni inventar su número; en max-reliability el post-check debe marcar UNVERIFIED_CITATION / NO_EVIDENCE si se menciona.

---

## Resumen de archivos

| Archivo | Descripción |
|---------|-------------|
| `scripts/ingest_manual.ts` | Script de ingesta manual: published_date = promulgación, --effective opcional = effective_date; title puede ser "(texto consolidado 2024)". |
| `supabase/migrations/20250223100000_match_vigente_chunks.sql` | Función RPC para búsqueda por similitud en todos los instrumentos VIGENTES. |
| `supabase/migrations/20250224000000_match_vigente_chunks_effective_date.sql` | Añade effective_date al RPC match_vigente_chunks. |
| `src/lib/rag/vigente.ts` | `embedQuery`, `retrieveVigenteChunksWithEmbedding`, `retrieveVigenteChunks`, `formatVigenteContext`, `formatMaxReliabilityContext`. |
| `src/app/api/chat/route.ts` | Modo max-reliability: CAPA 1 (0 chunks → NO_EVIDENCE sin modelo), CAPA 2 (prompt + JSON estricto), CAPA 3 (post-check artículos), citations solo de chunks, `legal_audit_log`. Modo standard intacto. |

No se ha cambiado la UI. Todo compila con Next.js 14.
