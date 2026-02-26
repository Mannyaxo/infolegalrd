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

```bash
npm install
cp .env.example .env.local   # Rellena NEXT_PUBLIC_SUPABASE_*, OPENAI_API_KEY
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Ingesta de leyes (RAG)

Para cargar normativa desde archivos TXT o desde consultoria.gov.do, ver **[docs/INGESTA_LEYES.md](./docs/INGESTA_LEYES.md)**. Resumen:

- **Ingesta manual (batch):** `npm run ingest:manual -- --all` o `--files "path1,path2"`
- **Crawler consultoria.gov.do:** `npm run crawl:consultoria` (requiere `FIRECRAWL_API_KEY` en `.env.local`)

## Despliegue en Vercel

Ver **[DEPLOY.md](./DEPLOY.md)** para:

1. Crear y configurar Supabase (tablas, RLS, Auth)
2. Variables de entorno en Vercel
3. Deploy del proyecto
4. (Opcional) Stripe para suscripción premium

### Checklist: variables de entorno en producción

- **`.env.local`** solo se usa en desarrollo local; Vercel **no** lo lee.
- En Vercel: **Project → Settings → Environment Variables** define las variables para **Production**, **Preview** y/o **Development**.
- Después de añadir o cambiar variables en Vercel, hay que **Redeploy** (Deployments → Redeploy) o hacer **push** de un nuevo commit para que se apliquen.
- Para comprobar que las variables están disponibles en producción, abre **`https://tu-dominio.vercel.app/api/env-check`** y revisa que los valores `env.*` sean `true` (no se muestran secretos, solo si están definidos y el host de Supabase).

## Aviso legal

Toda la información de la aplicación es **general y orientativa**. No constituye asesoramiento legal vinculante ni crea relación abogado-cliente. Siempre se debe consultar a un abogado colegiado para el caso específico.
