import { Chatbot } from "@/components/chat/Chatbot";

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen flex-col">
      <div className="flex-1 px-4 py-6">
        <h1 className="mb-4 text-center text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Consulta Legal Informativa RD – Solo orientación general
        </h1>
        <Chatbot />
      </div>
      <footer className="border-t border-slate-200 py-4 dark:border-slate-700">
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Esta herramienta ofrece información general educativa. No sustituye la consulta con un abogado colegiado.
        </p>
      </footer>
    </div>
  );
}
