# AGENTS.md

## Cursor Cloud specific instructions

### Overview

**InfoLegal RD** is a Next.js 14 (App Router) legal information chatbot for Dominican Republic law. Single-service app (no monorepo). See `README.md` for stack details and `DEPLOY.md` for Vercel deployment.

### Running the app

- `npm run dev` starts the dev server on `http://localhost:3000`
- `npm run build` for production build
- `npm run lint` for ESLint checks (uses `next lint` with `next/core-web-vitals` config)

### Node.js version

The project requires **Node.js 24.x** (`engines` field in `package.json`). Use `nvm use 24` before running commands.

### Environment variables

Copy `.env.example` to `.env.local` and fill in values. The app will start with placeholder values but the chatbot requires real API keys to produce meaningful responses:
- **Required for chat**: `ANTHROPIC_API_KEY` (primary orchestrator). Without it, chat returns 503.
- **Optional AI agents**: `XAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` — gracefully skipped if missing.
- **Required for auth/rate-limiting**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Optional**: Stripe keys for premium subscriptions, `SERPER_API_KEY` for legal source search.

### Gotchas

- The repo ships without an `.eslintrc.json` — running `npm run lint` for the first time triggers an interactive prompt. The `.eslintrc.json` file (extending `next/core-web-vitals`) was added to avoid this.
- There are no automated tests in this repo (no test framework or test files).
- The `env-check` API endpoint (`/api/env-check`) is useful for verifying which environment variables are configured.
