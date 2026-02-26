# Ingesta de leyes y corpus legal — InfoLegal RD

Este documento describe cómo cargar normativa (TXT manual y crawl de consultoria.gov.do) para el RAG del chat.

## Requisitos de entorno

En `.env.local`:

- `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (obligatorio para ingesta; no usar anon)
- `OPENAI_API_KEY` (para embeddings)
- Para el crawler: `FIRECRAWL_API_KEY`

## 1. Ingesta manual (archivos TXT en batch)

Los archivos TXT ya listos pueden estar en `documents/` con cualquier estructura de carpetas. El script deriva `canonical_key` y `title` desde la ruta (carpeta y nombre de archivo).

### Ingestar todos los TXT bajo `documents/`

```bash
npm run ingest:manual -- --all
```

Esto descubre todos los `.txt` bajo `documents/` y los ingesta uno a uno (mismo `published_date` y `source_url` por defecto).

### Ingestar archivos concretos

```bash
npm run ingest:manual -- --files "documents/constitucion/constitucion.txt,documents/Ley 41-08 Función Pública/41-08.txt"
```

### Opciones

| Opción        | Descripción                                      | Default        |
|---------------|--------------------------------------------------|----------------|
| `--all`       | Ingestar todos los .txt en `documents/`          | -              |
| `--files`     | Lista de rutas separadas por coma                | -              |
| `--published` | Fecha de promulgación (YYYY-MM-DD)                | Hoy            |
| `--source_url`| URL de origen                                    | `manual-ingest`|
| `--status`    | Estado de la versión                             | `VIGENTE`     |

Reglas de derivación (ejemplos):

- `documents/constitucion/constitucion.txt` → `canonical_key`: `CONSTITUCION-RD`, título: Constitución de la República Dominicana.
- Carpeta "Ley 41-08 Función Pública" + archivo `41-08.txt` → `LEY-41-08`, título = nombre de la carpeta.
- Carpeta "Decreto 523-09 ..." → `DECRETO-523-09`.

Se usa **SUPABASE_SERVICE_ROLE_KEY** para insertar. Los embeddings se generan con OpenAI `text-embedding-3-small`.

---

## 2. Crawler consultoria.gov.do (Firecrawl)

Crawl selectivo sobre la Consultoría Jurídica del Poder Ejecutivo para descubrir leyes/decretos/resoluciones y añadirlos al corpus.

### Ejecutar

```bash
npm run crawl:consultoria
```

Comportamiento:

- Inicia un crawl en `https://www.consultoria.gov.do/consulta/` con **limit=20** (prueba).
- Filtra solo páginas cuya URL contenga: `ley`, `decreto`, `resolucion`, `constitucion`.
- Por cada documento: extrae título, URL, texto (markdown); deriva `canonical_key` (ej. LEY-41-08, DECRETO-523-09).
- Compara `content_hash` con las versiones existentes del mismo instrumento.
- Si es nuevo o cambió: marca versiones vigentes anteriores como DEROGADA, crea nueva `instrument_version` con status VIGENTE, hace chunking y genera embeddings → `instrument_chunks`.

Requiere **FIRECRAWL_API_KEY** en `.env.local` (no incluir la key en el código).

---

## 3. Verificación (SQL)

En el cliente SQL de Supabase (o `psql`):

**Conteo de instrumentos y versiones vigentes:**

```sql
SELECT i.canonical_key, i.title, COUNT(v.id) AS versiones_vigentes
FROM instruments i
LEFT JOIN instrument_versions v ON v.instrument_id = i.id AND v.status = 'VIGENTE'
GROUP BY i.id, i.canonical_key, i.title
ORDER BY i.canonical_key;
```

**Conteo de chunks por instrumento vigente:**

```sql
SELECT i.canonical_key, COUNT(c.id) AS chunks
FROM instruments i
JOIN instrument_versions v ON v.instrument_id = i.id AND v.status = 'VIGENTE'
JOIN instrument_chunks c ON c.instrument_version_id = v.id
GROUP BY i.canonical_key
ORDER BY i.canonical_key;
```

**Últimas versiones ingeridas:**

```sql
SELECT i.canonical_key, v.published_date, v.source_url, v.status, LENGTH(v.content_text) AS content_len
FROM instrument_versions v
JOIN instruments i ON i.id = v.instrument_id
ORDER BY v.fetched_at DESC
LIMIT 20;
```

---

## Resumen de comandos

| Comando | Descripción |
|--------|-------------|
| `npm run ingest:manual -- --all` | Ingesta todos los .txt en `documents/` |
| `npm run ingest:manual -- --files "path1,path2"` | Ingesta los archivos indicados |
| `npm run crawl:consultoria` | Crawl selectivo consultoria.gov.do (limit 20) |

Los modos normal y máxima confiabilidad del chat no se modifican; solo se alimenta el corpus RAG con más instrumentos y versiones vigentes.
