"use client";

import { useState } from "react";
import { Chatbot } from "@/components/chat/Chatbot";
import Link from "next/link";

export const dynamic = "force-dynamic";

const EXAMPLE_QUERIES = [
  "¿Qué es la renuncia voluntaria en el trabajo y qué efectos tiene en RD?",
  "¿Cuáles son los requisitos para un divorcio de mutuo acuerdo en República Dominicana?",
  "¿Qué dice la ley sobre el preaviso en un contrato de colaboración independiente?",
];

export default function HomePage() {
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Indicador de sistema */}
      <div className="border-b border-slate-200 bg-white/80 py-2 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mx-auto max-w-4xl px-4 text-center text-sm text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Sistema activo — análisis legal informativo
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Hero */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            InfoLegal RD
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            Orientación legal informativa basada en la legislación dominicana. Consultas generales,
            marco normativo y preguntas frecuentes — siempre con carácter educativo.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <span className="text-emerald-500">✓</span> Basado en legislación dominicana
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <span className="text-emerald-500">✓</span> Análisis estructurado por IA
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <span className="text-emerald-500">✓</span> Información educativa, no asesoría legal
            </span>
          </div>
        </header>

        {/* ¿Cómo funciona? */}
        <section className="mb-10">
          <h2 className="mb-6 text-center text-xl font-semibold text-slate-800 dark:text-slate-100">
            ¿Cómo funciona?
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-800/50">
              <div className="mb-3 text-2xl">1️⃣</div>
              <h3 className="font-medium text-slate-900 dark:text-white">Haces tu consulta</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Escribe tu duda de forma general o elige un ejemplo de consulta.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-800/50">
              <div className="mb-3 text-2xl">2️⃣</div>
              <h3 className="font-medium text-slate-900 dark:text-white">IA analiza normativa dominicana</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Nuestro sistema cruza fuentes oficiales y normativa aplicable en RD.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-800/50">
              <div className="mb-3 text-2xl">3️⃣</div>
              <h3 className="font-medium text-slate-900 dark:text-white">Recibes orientación estructurada</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Respuesta organizada con marco legal, preguntas esenciales y advertencias.
              </p>
            </div>
          </div>
        </section>

        {/* Ejemplos clicables */}
        <section className="mb-6">
          <p className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">
            Ejemplos de consultas:
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setSuggestedQuery(q)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-[#1e40af] hover:bg-blue-50 hover:text-[#1e40af] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700"
              >
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* Chat */}
        <Chatbot
          suggestedQuery={suggestedQuery ?? undefined}
          onSuggestionApplied={() => setSuggestedQuery(null)}
        />
      </div>

      {/* Footer institucional */}
      <footer className="mt-12 border-t border-slate-200 bg-white py-8 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="mx-auto max-w-4xl px-4">
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">
            Esta herramienta ofrece información general educativa. No constituye asesoramiento legal
            vinculante ni sustituye la consulta con un abogado colegiado.
          </p>
          <nav className="mt-4 flex justify-center gap-6 text-sm">
            <Link
              href="#"
              className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Privacidad
            </Link>
            <Link
              href="#"
              className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Términos
            </Link>
            <Link
              href="#"
              className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Contacto
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
