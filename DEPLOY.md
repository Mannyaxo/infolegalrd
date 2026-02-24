# DEPLOY.md - Cómo publicar InfoLegalRD en Vercel

## Pasos para redeployar después de cambios

1. Commit y push a GitHub:
   git add .
   git commit -m "Arreglo Node version para Vercel"
   git push origin main

2. Ve a https://vercel.com/dashboard → selecciona tu proyecto (infolegalrd).
3. Ve a la pestaña Deployments → haz clic en Redeploy (el botón con flecha circular en el último deploy).
4. Espera 1–3 minutos hasta que diga "Ready".
5. El link público estará en la parte superior (ej. https://infolegalrd.vercel.app).

## Si es la primera vez:
- Importa el repo desde GitHub si no está conectado.
- Añade Environment Variables en Settings → Environment Variables:
  - XAI_API_KEY = ...
  - GEMINI_API_KEY = ...
  - OPENAI_API_KEY = ...
  - ANTHROPIC_API_KEY = ...
  - GROQ_API_KEY = ... (opcional)

Tips:
- Node version: Vercel usa 24.x automáticamente con "engines".
- Si hay error, revisa logs en Deployments.
