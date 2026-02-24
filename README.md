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

## Despliegue en Vercel

Ver **[DEPLOY.md](./DEPLOY.md)** para:

1. Crear y configurar Supabase (tablas, RLS, Auth)
2. Variables de entorno en Vercel
3. Deploy del proyecto
4. (Opcional) Stripe para suscripción premium

## Aviso legal

Toda la información de la aplicación es **general y orientativa**. No constituye asesoramiento legal vinculante ni crea relación abogado-cliente. Siempre se debe consultar a un abogado colegiado para el caso específico.
