# Dónde estoy y qué probar — InfoLegal RD

Guía rápida para orientarte y probar el sistema.

---

## 1. Dónde estás

- **Proyecto:** Next.js 14 + Supabase (pgvector) + RAG con leyes RD.
- **Pantalla principal:** Landing con panel de consulta (modo Normal / Máxima Confiabilidad).
- **Flujo:** Usuario escribe → RAG busca chunks en Supabase → LLM responde con ese contexto → (en modo max) Judge + verificación de claims → respuesta + **panel de fuentes** con similitud.

---

## 2. Antes de probar (una vez)

### Variables de entorno
En la raíz del proyecto, archivo `.env.local` (o en Vercel):

- `NEXT_PUBLIC_SUPABASE_URL` — URL del proyecto Supabase  
- `SUPABASE_SERVICE_ROLE_KEY` — clave con permisos  
- `OPENAI_API_KEY` — embeddings y fallback  
- `ANTHROPIC_API_KEY` — modo Máxima Confiabilidad (Claude)

### Migración del RAG (umbral de similitud)
Si aún no la aplicaste:

1. Abre **Supabase** → tu proyecto → **SQL Editor**.
2. Copia y ejecuta el contenido de:
   ```
   supabase/migrations/20250228200000_match_vigente_chunks_threshold.sql
   ```
   O desde la raíz del proyecto: `npx supabase db push` (si tienes Supabase CLI vinculado).

### Tener algo en el RAG
Si la base está vacía, no habrá chunks. Opciones:

- **Ingesta manual** (leyes desde `.txt` en `documents/`):
  ```bash
  npm run ingest:manual -- --all
  ```
- O usar una consulta; si no hay evidencia, se encola y (si está activo) se lanza el worker de enriquecimiento.

---

## 3. Arrancar y abrir la app

En la raíz del proyecto:

```bash
npm install
npm run dev
```

Abre **http://localhost:3000**. Ahí está la landing y el panel de consulta.

---

## 4. Qué probar (en orden)

### A) Probar solo el RAG (sin gastar LLM)
1. En la misma página, baja hasta el bloque **"Probar RAG (recuperación)"** y ábrelo.
2. Escribe una consulta (ej: *preaviso laboral* o *ley 16-92*) y pulsa **"Probar recuperación"**.
3. Deberías ver: número de chunks y lista con **título**, **canonical_key** y **fragmento**. Si tienes la migración nueva, también **similitud** (porcentaje).
4. Si sale 0 chunks: no hay datos o el umbral de similitud está filtrando todo (en código el default es 0.65).

### B) Consulta en modo Normal
1. Arriba, deja el modo **Normal**.
2. Escribe algo que toque leyes que hayas ingestado (ej: *¿Qué dice la ley sobre el preaviso en RD?*).
3. Deberías ver: respuesta de la IA y, debajo, **"Fuentes utilizadas"** con acordeones (título, % similitud, fragmento, enlace).
4. Si la respuesta dice algo tipo "vuelve en 5–10 minutos": no hubo suficientes chunks; revisa ingesta o prueba **Probar RAG** con la misma frase.

### C) Consulta en modo Máxima Confiabilidad
1. Activa **Máxima Confiabilidad**.
2. Haz una consulta similar.
3. Deberías ver: respuesta más acotada al contexto + mismas fuentes debajo (y, si aplica, preguntas de clarificación o mensaje de “busco la ley…”).

### D) Probar enriquecimiento (opcional)
1. Pregunta por una ley que **no** tengas ingestada (ej: *¿Qué dice la ley 47-25?*).
2. Si no hay chunks: se encola y verás el mensaje de “busco y verifico… vuelve en 5–10 min”.
3. Si tienes `AUTO_RUN_ENRICH_QUEUE` activo (por defecto sí), se lanzará el worker en segundo plano. Luego puedes procesar la cola a mano:
   ```bash
   npm run enrich:queue -- --once --force
   ```

---

## 5. Comandos útiles

| Comando | Para qué |
|--------|----------|
| `npm run dev` | App en local (http://localhost:3000) |
| `npm run build` | Ver que compila (ej. antes de push a Vercel) |
| `npm run ingest:manual -- --all` | Ingestar todos los `.txt` de `documents/` |
| `npm run enrich:queue -- --once --force` | Procesar una vez la cola de enriquecimiento |
| `npm run verify:rag` | Comprobar RPC de RAG (si existe el script) |

---

## 6. Si algo falla

- **"0 chunks" en Probar RAG:** Revisa que hayas aplicado las migraciones y que existan filas en `instrument_chunks` con `embedding` no nulo y versiones con `status = 'VIGENTE'`.
- **Error de Supabase en la app:** Revisa `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`.
- **La IA no responde o da error:** Revisa `OPENAI_API_KEY` y `ANTHROPIC_API_KEY`; en consola del navegador (o terminal del `dev`) suele salir el error concreto.

---

**Resumen:** Estás en el flujo **consulta → RAG (Supabase) → LLM → respuesta + fuentes**. Arranca con `npm run dev`, abre localhost:3000, prueba primero **"Probar RAG"** y luego una consulta en **Normal**; con eso ya ves por dónde vas.
