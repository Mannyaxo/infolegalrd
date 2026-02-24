# DEPLOY.md - Cómo actualizar InfoLegalRD en Vercel (sin crear proyecto nuevo)

## Pasos para redeployar después de cualquier cambio

1. Commit y push a GitHub (en la terminal de Cursor):
   git add .
   git commit -m "Cambios nuevos: [describe brevemente]"
   git push origin main

2. Ve a https://vercel.com/dashboard
3. Selecciona tu proyecto actual (infolegalrd o infollegalrd-iu6d, el que tiene tu repo conectado).
4. Ve a la pestaña Deployments.
5. Busca el último deploy → haz clic en Redeploy (botón con flecha circular).
6. Espera 1–3 minutos hasta que diga "Ready" o "Success".
7. El link público se actualiza automáticamente (ej. https://infolegalrd.vercel.app).

## Si es la primera vez o Vercel pide configuración:
- Asegúrate de que el proyecto esté conectado a Mannyaxo/infolegalrd (Settings → Git).
- Añade Environment Variables en Settings → Environment Variables (si no están):
  - XAI_API_KEY = [tu valor]
  - GEMINI_API_KEY = [tu valor]
  - OPENAI_API_KEY = [tu valor]
  - ANTHROPIC_API_KEY = [tu valor]
  - GROQ_API_KEY = [opcional]
- Redeploy después de añadirlas.

Tips:
- Node version: Vercel usa 24.x automáticamente con "engines" en package.json.
- Si hay error, revisa logs en Deployments → Build Logs.
