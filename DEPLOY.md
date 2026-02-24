# Deploy en Vercel — InfoLegal RD

Pasos detallados para publicar el proyecto en Vercel a partir del repositorio en GitHub.

---

## 1. Preparar el repositorio local

```bash
git init
git add .
git commit -m "Initial commit"
```

Asegúrate de que **no** se suban claves: `.env`, `.env.local` y variantes deben estar en `.gitignore` (ya incluidos).

---

## 2. Subir a GitHub

1. Crea un repositorio nuevo en [GitHub](https://github.com/new) (por ejemplo `INFOLEGALRD` o `infolegalrd`).
2. No inicialices con README si ya tienes código local.
3. En tu proyecto local:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git branch -M main
git push -u origin main
```

Sustituye `TU_USUARIO` y `TU_REPO` por tu usuario y nombre del repositorio.

---

## 3. Crear proyecto en Vercel

1. Entra en [vercel.com](https://vercel.com) e inicia sesión (con GitHub si lo usas).
2. **Add New…** → **Project**.
3. **Import Git Repository**: elige el repositorio de GitHub del proyecto.
4. Vercel detectará Next.js; deja **Build Command**: `next build` y **Output Directory**: `.next` (por defecto).
5. Avanza sin hacer deploy todavía (o haz el primer deploy; luego añadirás variables).

---

## 4. Variables de entorno

En el proyecto de Vercel: **Settings** → **Environment Variables**.

Añade estas variables (marcando **Production**, y opcionalmente **Preview** si usas ramas):

| Variable            | Descripción                    | Obligatoria |
|---------------------|--------------------------------|-------------|
| `XAI_API_KEY`       | API key de xAI (Grok)          | Sí*         |
| `GEMINI_API_KEY`    | API key de Google AI (Gemini)  | Sí*         |
| `OPENAI_API_KEY`    | API key de OpenAI              | Sí*         |
| `ANTHROPIC_API_KEY` | API key de Anthropic (Claude)  | Sí*         |
| `GROQ_API_KEY`      | API key de Groq                | Opcional    |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Sí (auth/DB) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase | Sí (auth/DB) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (límite consultas en servidor) | Recomendado |

\* El chatbot multi‑agente usa varios proveedores; si falta una key, ese agente no contribuirá pero el resto seguirá funcionando.

**Importante:** No cachees `.env` ni subas claves al repo. En Vercel solo se usan las variables configuradas en la consola.

---

## 5. Deploy

1. **Deployments** → **Redeploy** (o lanza el primer deploy desde el paso 3).
2. Cuando termine, obtendrás una **URL pública** tipo `https://tu-proyecto.vercel.app`.
3. Opcional: en **Settings** → **Domains** puedes añadir un dominio propio.

---

## 6. Tips

- **Node:** El proyecto usa `"engines": { "node": "18.x" }` en `package.json`. Vercel suele tomar Node 18.x por defecto; si pide versión, ya está indicada.
- **Build:** Comando por defecto `next build`; no hace falta cambiarlo. Si en local falla el build por `.next` corrupto (p. ej. en Windows/OneDrive), borra la carpeta `.next` y vuelve a ejecutar `npm run build`.
- **Env:** No subas nunca `.env` ni `.env.local`. Todas las claves solo en **Environment Variables** de Vercel.
- **Supabase:** Configura en Supabase las URLs de producción (por ejemplo `https://tu-proyecto.vercel.app`) en Authentication → URL redirects si usas login con redirect.
