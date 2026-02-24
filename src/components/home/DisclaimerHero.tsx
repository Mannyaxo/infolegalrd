const DISCLAIMER =
  "Este análisis es orientativo y se basa únicamente en la información proporcionada de forma genérica. No constituye asesoramiento legal vinculante, no crea relación abogado-cliente y no sustituye la consulta con un abogado colegiado. Se recomienda encarecidamente acudir a un profesional habilitado para evaluar su caso concreto.";

export function DisclaimerHero() {
  return (
    <section className="px-4 pt-8 pb-6 sm:pt-12 sm:pb-8">
      <div className="disclaimer-box mx-auto max-w-4xl rounded-xl p-6 sm:p-8 text-center">
        <p className="text-lg font-semibold text-amber-900 dark:text-amber-100 sm:text-xl">
          ⚠️ Info legal general RD – Siempre consulta abogado
        </p>
        <p className="mt-3 text-sm sm:text-base text-amber-800 dark:text-amber-200">
          {DISCLAIMER}
        </p>
      </div>
      <p className="mx-auto mt-6 max-w-2xl text-center text-slate-600 dark:text-slate-400 text-sm sm:text-base">
        Aquí encontrarás información legal general y educativa sobre República Dominicana: laboral, civil, trámites y más.
        Nada de lo que leas aquí sustituye la asesoría de un profesional colegiado.
      </p>
    </section>
  );
}
