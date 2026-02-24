import Link from "next/link";
import { PlantillaAcuerdoTerminacion } from "@/components/plantillas/PlantillaAcuerdoTerminacion";

export const metadata = {
  title: "Plantillas descargables – InfoLegal RD",
  description: "Modelos de documentos legales informativos para República Dominicana.",
};

export default function PlantillasPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold text-legal-dark dark:text-white sm:text-3xl">
        Plantillas descargables
      </h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400 text-sm sm:text-base">
        Modelos de referencia con fines informativos. No sustituyen asesoría legal. Adapta siempre con un profesional.
      </p>

      <div className="mt-8 space-y-8">
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-semibold text-legal-dark dark:text-white">
            Acuerdo de Terminación de Colaboración Independiente
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Modelo para documentar el mutuo acuerdo de fin de una relación de colaboración independiente (no laboral) en RD.
          </p>
          <PlantillaAcuerdoTerminacion />
        </section>
      </div>

      <p className="mt-8 text-center text-sm text-amber-700 dark:text-amber-300">
        Esta información es general y orientativa. No constituye asesoramiento legal. Consulta a un abogado para tu caso.
      </p>
      <p className="mt-4 text-center">
        <Link href="/" className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm">
          ← Volver al inicio
        </Link>
      </p>
    </div>
  );
}
