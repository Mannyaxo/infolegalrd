# Informe del proyecto InfoLegal RD — Contexto para IA

Este documento resume el estado actual del proyecto **InfoLegal RD** y todo lo implementado hasta la fecha, para que otra IA o equipo pueda continuar el trabajo con contexto completo.

---

## 1. Qué es InfoLegal RD

- **Producto:** Asistente legal basado en IA para derecho dominicano (República Dominicana).
- **Stack:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Supabase (auth, DB, vectores), Claude (Anthropic) como orquestador, RAG sobre normativa vigente.
- **Objetivo:** Ofrecer orientación legal educativa e informativa (no sustituye abogado); consultas en lenguaje natural con respuestas fundamentadas en leyes vigentes en RD.

---

## 2. Trabajo realizado recientemente: Landing v2

Se rediseñó la **página principal** (`/`) para que coincida con un diseño de referencia (HTML estático `infolegal-rd-v2.html`): tema oscuro, hero, sección de consulta con áreas y panel, “Cómo funciona”, FAQ y footer.

### 2.1 Estilos (tema v2)

- **Archivo:** `src/app/globals.css`
- **Clase contenedora:** `.page-v2`
- **Variables CSS** definidas bajo `.page-v2`:
  - Fondos: `--bg`, `--bg2`, `--bg3`, `--surface`, `--surface2`
  - Bordes: `--border`, `--border2`
  - Acentos: `--sage`, `--sage-dim`, `--sage-glow`, `--off-white`, `--muted`, `--muted2`, `--accent`
- **Tipografías:** `--font-outfit` (UI) y `--font-playfair` (marca/títulos), definidas en `layout.tsx` con `next/font/google`.
- **Componentes estilizados:** nav (`.nav-v2`, `.logo-v2`, `.nav-center`, `.btn-ghost`, `.btn-sage`), hero (grid de fondo, `.hero-inner`, `.hero-label`, `.live-dot`, `.hero-title`, `.hero-sub`, `.hero-actions`, `.stats-bar`), sección de consulta (`.query-section`, `.qs-left`, `.areas-list`, `.area-row`), panel (`.query-panel`, `.qp-header`, `.qp-modes`, `.mode-pill`, `.qp-body`, `.qp-example`, `.qp-textarea`, `.qp-submit`, `.qp-response`, `.loading-dots`), “Cómo funciona” (`.section-how`, `.how-grid`, `.how-card`), FAQ (`.section-faq`, `.faq-item`, `.faq-btn`, `.faq-plus`, `.faq-ans`), footer (`.footer-v2`, `.footer-top`, `.footer-bottom`).
- **Responsive:** media query aprox. 1024px (nav, consulta en una columna, footer en 2 columnas).

### 2.2 Layout y navegación

- **`src/app/layout.tsx`:**
  - Carga fuentes Google: `Playfair_Display` y `Outfit` con variables CSS `--font-playfair` y `--font-outfit`.
  - Ya no renderiza un header genérico ni `<main>` directamente; delega en **LayoutSwitcher**.

- **`src/components/layout/LayoutSwitcher.tsx`** (nuevo):
  - Cliente (`"use client"`), usa `usePathname()`.
  - Si `pathname === "/"`: renderiza solo `children` (la home tiene su propia nav y no usa el Header global).
  - En cualquier otra ruta: renderiza `Header` y `<main className="min-h-[calc(100vh-4rem)]">{children}</main>`.

### 2.3 Página de inicio (`src/app/page.tsx`)

- Contenedor: `className="page-v2 min-h-screen"`.
- **CursorGlow:** componente cliente que mueve un div (clase `.cursor-glow`) siguiendo el mouse; efecto sutil de brillo sage.
- **Nav:** logo “InfoLegal RD”, enlaces (Consultar, Áreas, Proceso, FAQs, Plantillas), “Iniciar sesión” (Link a `/login`) y botón “Consultar ahora” que hace scroll a `#consulta`.
- **Hero:** label “Sistema activo · IA Legal Dominicana” con indicador `.live-dot`, título “Derecho dominicano al alcance de todos.”, subtítulo, botones “Hacer una consulta” y “Ver cómo funciona”, barra de estadísticas (+50 consultas, 24/7, 100% RD).
- **Sección de consulta** (`id="consulta"`):
  - Columna izquierda: “Áreas de práctica” y lista fija `AREAS` (laboral, familia, inmobiliario, comercial, civil, penal, constitucional). Cada fila tiene una consulta de ejemplo; al hacer clic se llama `fillFromArea(area.query)` (establece `suggestedQuery` y hace scroll al panel).
  - Columna derecha: **QueryPanel** con `suggestedQuery={suggestedQuery}` y `onSuggestionApplied={() => setSuggestedQuery(null)}`.
- **Cómo funciona** (`id="como-funciona"`): 3 tarjetas (01 Escribe tu consulta, 02 IA analiza normativa, 03 Orientación estructurada).
- **FAQ** (`id="faqs"`): acordeón con estado `openFaq` (índice o null); array `FAQS` con 5 preguntas; al clic se alterna clase `.open` en el `.faq-item`.
- **Footer:** logo, descripción, columnas (Navegación, Recursos, Legal), copyright y nota de orientación educativa.

### 2.4 Panel de consulta (`src/components/chat/QueryPanel.tsx`)

- **Props:** `suggestedQuery?: string | null`, `onSuggestionApplied?: () => void`.
- **Estado:** `input`, `maxReliability` (boolean), `loading`, `response` (`"idle" | "answer" | "clarify" | "reject"`), `content`, `clarifyQuestions`, `rejectMessage`.
- **useEffect:** cuando existe `suggestedQuery`, asigna `setInput(suggestedQuery)` y llama `onSuggestionApplied()`.
- **UI:** header “Consulta Legal” + badge “IA Activa”; dos modos (pills): Normal / Máxima Confiabilidad; ejemplos clicables que rellenan el textarea; textarea y botón “Analizar consulta”; zona de respuesta (answer/clarify/reject); loading con `.loading-dots`; disclaimer debajo.
- **Envío:** `POST /api/chat` con body: `{ message, history: [], userId, mode: "standard" | "max-reliability" }`. `userId` viene de `useAuth(supabase)` (puede ser null).
- **Respuesta API:**
  - `type: "answer"` → se muestra `content` en `.qp-response-body` (por ahora se hace `split("\n")` y se envuelve en `<p>`; no hay renderizado Markdown todavía).
  - `type: "clarify"` → se muestran las preguntas para aclarar.
  - `type: "reject"` → se muestra el mensaje de rechazo.
- La home **no** usa el componente **Chatbot** antiguo; la funcionalidad de chat en la landing es únicamente este **QueryPanel** (una consulta por vez, mismo API `/api/chat`).

---

## 3. API de chat (`/api/chat`)

- **Método:** POST.
- **Body esperado:** `{ message: string, history: array, userId?: string | null, mode?: "standard" | "max-reliability" }`.
- **Tipos de respuesta (JSON):**
  - `AnswerResponse`: `{ type: "answer", content: string, note?: string }`
  - `ClarifyResponse`: `{ type: "clarify", questions: string[] }`
  - `RejectResponse`: `{ type: "reject", message: string }`
- **Modo estándar:** flujo normal de orquestador + RAG.
- **Modo max-reliability:** capa adicional de verificación (referencias a artículos, revisión de jurisprudencia aplicable); ver `docs/RAG_MVP_MAXIMA_CONFIABILIDAD.md` y lógica en `route.ts` (branch `mode === "max-reliability"`).

---

## 4. Estructura de archivos relevante

```
src/
  app/
    globals.css          # Tema global + todo el CSS de .page-v2
    layout.tsx           # Fuentes Playfair/Outfit + LayoutSwitcher
    page.tsx             # Página principal v2 (hero, consulta, how, faq, footer)
    api/
      chat/
        route.ts         # POST /api/chat (orquestador, RAG, modos standard/max-reliability)
  components/
    layout/
      LayoutSwitcher.tsx # Muestra solo children en "/", Header+main en el resto
      Header.tsx         # Header usado en el resto de rutas
    chat/
      QueryPanel.tsx     # Panel de consulta en la home (textarea, modos, envío a /api/chat)
      Chatbot.tsx        # Chat completo (usado en otras vistas, no en la home actual)
  ...
docs/
  RAG_MVP_MAXIMA_CONFIABILIDAD.md   # Documentación del modo máxima confiabilidad
  INFORME_PROYECTO_INFOLEGAL_RD.md  # Este informe
```

---

## 5. Rutas principales

- **`/`** — Página principal v2 (landing con hero, consulta con QueryPanel, cómo funciona, FAQ, footer). Sin Header global.
- **`/login`** — Inicio de sesión.
- **`/plantillas`** — Plantillas legales (con Header).
- Otras rutas que usen el layout con Header: mismo patrón vía LayoutSwitcher.

---

## 6. Pendientes / sugerencias

- **Build:** `npm run build` ya se ejecutó y compila correctamente.
- **QueryPanel:** mejorar el renderizado del `content` cuando `type === "answer"` (p. ej. Markdown o la misma lógica que en Chatbot para resumen/preguntas/resto).
- **Tests:** no se han añadido tests automatizados para la landing v2 ni para QueryPanel.
- **Accesibilidad:** revisar roles ARIA y contraste en tema oscuro si se requiere cumplimiento estricto.

---

## 7. Cómo usar este informe

- Entregar este archivo (o su versión en Word/PDF) a otra IA o desarrollador para que tenga contexto completo del proyecto y de lo implementado en la landing v2.
- Para abrirlo en Word: abrir Microsoft Word → Archivo → Abrir → seleccionar `INFORME_PROYECTO_INFOLEGAL_RD.md`. Word puede abrir Markdown y, si se desea, guardar como `.docx`.

---

*Documento generado para traspaso de contexto del proyecto InfoLegal RD. Fecha de referencia: febrero 2025.*
