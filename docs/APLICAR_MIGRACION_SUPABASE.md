# Aplicar migración del corpus legal en Supabase (paso a paso)

Esta guía aplica las tablas **sources**, **instruments**, **instrument_versions**, **instrument_chunks** (pgvector) y **legal_audit_log** en tu proyecto Supabase **sin tocar** las tablas que ya tienes (faqs, consultas_diarias, usuarios_premium).

---

## Orden de comandos (resumen)

1. Instalar Supabase CLI (si no lo tienes).
2. `supabase login`
3. `supabase init` (solo si no tienes carpeta `supabase` con config).
4. `supabase link --project-ref TU_PROJECT_REF`
5. `supabase db push`
6. Verificar con 3 queries en el SQL Editor.

---

## 1) Instalar Supabase CLI

**Windows (PowerShell, con npm):**

```powershell
npm install -g supabase
```

**O con Scoop (si lo usas):**

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**Comprueba que quedó instalado:**

```powershell
supabase --version
```

---

## 2) Iniciar sesión en Supabase

En la terminal, desde cualquier carpeta:

```powershell
supabase login
```

Se abrirá el navegador para que inicies sesión con tu cuenta de Supabase. Cuando termines, vuelve a la terminal.

---

## 3) Inicializar Supabase en el repo (solo si hace falta)

Solo si **no** tienes un archivo `supabase/config.toml` en tu proyecto:

1. Abre la terminal.
2. Ve a la carpeta del proyecto (donde está `package.json`):

```powershell
cd "c:\Users\distr\OneDrive\Desktop\INFOLEGALRD"
```

3. Ejecuta:

```powershell
supabase init
```

Eso crea `supabase/config.toml`. Si ya tenías `supabase/config.toml`, **no hace falta** que ejecutes `supabase init`.

---

## 4) Dónde sacar el Project Ref

1. Entra en [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Abre tu **proyecto** (el de InfoLegal RD).
3. En el menú izquierdo: **Project Settings** (icono de engranaje).
4. En **General** verás **Reference ID** (por ejemplo `abcdefghijklmnop`).  
   Ese es tu **Project Ref**.

---

## 5) Vincular el proyecto (link)

En la terminal, dentro de la carpeta del proyecto:

```powershell
cd "c:\Users\distr\OneDrive\Desktop\INFOLEGALRD"
supabase link --project-ref TU_PROJECT_REF
```

Sustituye `TU_PROJECT_REF` por el Reference ID (ej.: `abcdefghijklmnop`).

Te pedirá la **database password** del proyecto (la que definiste al crear el proyecto). Si no la recuerdas, en el dashboard: **Project Settings → Database → Database password** (y “Reset database password” si hace falta).

---

## 6) Aplicar la migración (push)

Sigue en la misma carpeta del proyecto:

```powershell
supabase db push
```

Eso aplica todo lo que está en `supabase/migrations/` (incluida la migración del corpus legal) a la base de datos del proyecto vinculado.  
Si algo falla, la terminal te dirá en qué migración o paso.

**Si el índice ivfflat falla** (por ejemplo “cannot create index on empty table”):  
Puedes comentar o borrar temporalmente en la migración las líneas del `CREATE INDEX ... instrument_chunks_embedding_idx`, volver a hacer `supabase db push`, y después de correr la ingesta de la Constitución crear ese índice a mano en el SQL Editor (te lo dejo abajo en “Extra”).

---

## 7) Verificar que todo existe (3 queries)

Abre en el dashboard: **SQL Editor** y ejecuta estas tres consultas, una por una.

**Query 1 – Comprobar que las 5 tablas existen:**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('sources', 'instruments', 'instrument_versions', 'instrument_chunks', 'legal_audit_log')
ORDER BY table_name;
```

Debes ver exactamente 5 filas: `instrument_chunks`, `instrument_versions`, `instruments`, `legal_audit_log`, `sources`.

---

**Query 2 – Comprobar extensión vector e índices del corpus:**

```sql
SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto');
```

Debes ver al menos `vector` (y si usas gen_random_uuid vía pgcrypto, también `pgcrypto`).

Luego:

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('sources', 'instruments', 'instrument_versions', 'instrument_chunks', 'legal_audit_log')
ORDER BY tablename, indexname;
```

Ahí deberían aparecer los índices de esas tablas (incluido el de `instrument_chunks` si se creó).

---

**Query 3 – Insertar y leer una fila de prueba (sources):**

```sql
INSERT INTO public.sources (name, base_url)
VALUES ('Prueba desde guía', 'https://ejemplo.gob.do')
RETURNING id, name, base_url, created_at;
```

Copia el `id` que te devuelva. Luego:

```sql
SELECT id, name, base_url, created_at FROM public.sources WHERE name = 'Prueba desde guía';
```

Debes ver la misma fila. Con eso confirmas que las tablas existen y que puedes insertar y leer.

(Opcional) Borrar la fila de prueba:

```sql
DELETE FROM public.sources WHERE name = 'Prueba desde guía';
```

---

## Resumen de comandos en orden

```powershell
cd "c:\Users\distr\OneDrive\Desktop\INFOLEGALRD"
npm install -g supabase
supabase login
supabase init
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

Después: Dashboard → SQL Editor → ejecutar las 3 queries de verificación.

---

## Extra: crear el índice ivfflat después de la ingesta

Si en el paso 6 decidiste no crear el índice porque la tabla estaba vacía, después de correr la ingesta de la Constitución puedes crearlo en el SQL Editor:

```sql
CREATE INDEX IF NOT EXISTS instrument_chunks_embedding_idx
  ON public.instrument_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

(Si ya tienes muchas filas, puedes subir `lists`; por ejemplo `lists = 200`.)
