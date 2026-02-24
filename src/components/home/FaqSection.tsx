"use client";

import { useState, useEffect } from "react";
import { useSupabase } from "@/components/providers/SupabaseProvider";

type Faq = { id: string; category: string; question: string; answer: string };

const FALLBACK_FAQS: Faq[] = [
  {
    id: "1",
    category: "Laboral",
    question: "¿Qué es la renuncia laboral en RD?",
    answer:
      "Es el acto por el cual el trabajador pone fin al contrato de trabajo de forma voluntaria. Debe notificarse por escrito al empleador. No genera derecho a indemnización por despido, pero sí a liquidación (salarios pendientes, proporcional de vacaciones y de aguinaldo). Esta información es general; consulta a un abogado para tu caso.",
  },
  {
    id: "2",
    category: "Laboral",
    question: "¿Cuántos días de vacaciones me corresponden?",
    answer:
      "Según el Código Laboral dominicano, después de un año de trabajo tienes derecho a 14 días laborables de vacaciones remuneradas. Deben concederse de forma continua cuando sea posible. Esta información es general; consulta a un abogado para tu caso.",
  },
  {
    id: "3",
    category: "Civil",
    question: "¿Qué es un contrato de compraventa y qué debe tener?",
    answer:
      "Es el contrato por el cual una parte (vendedor) se obliga a transferir la propiedad de un bien y la otra (comprador) a pagar un precio. En RD suele constar por escrito; en bienes inmuebles es necesario para inscripción en el Registro de Títulos. Debe identificar a las partes, el bien, el precio y las condiciones. Esta información es general; consulta a un abogado para tu caso.",
  },
  {
    id: "4",
    category: "Civil",
    question: "¿Cómo se hace un poder notarial en RD?",
    answer:
      "El poder es un acto por el cual una persona (poderdante) confiere a otra (apoderado) la facultad de representarla. Puede ser público (ante notario) o privado (firmado ante testigos según el caso). Para actos que lo exijan por ley, suele requerirse poder público. Esta información es general; consulta a un abogado para tu caso.",
  },
];

export function FaqSection() {
  const [faqs, setFaqs] = useState<Faq[]>(FALLBACK_FAQS);
  const [openId, setOpenId] = useState<string | null>(null);
  const supabase = useSupabase();

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("faqs")
      .select("id, category, question, answer")
      .order("category")
      .then(({ data }) => {
        if (data && data.length > 0) setFaqs(data as Faq[]);
      })
      .catch(() => {});
  }, [supabase]);

  return (
    <section id="faqs" className="px-4 py-12 sm:py-16">
      <h2 className="text-2xl font-bold text-legal-dark dark:text-white sm:text-3xl text-center mb-8">
        Preguntas frecuentes
      </h2>
      <div className="mx-auto max-w-3xl space-y-3">
        {faqs.map((faq) => (
          <div
            key={faq.id}
            className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setOpenId(openId === faq.id ? null : faq.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800 dark:text-slate-200 sm:text-base"
            >
              <span className="pr-2">{faq.question}</span>
              <span className="text-slate-500 dark:text-slate-400">
                {openId === faq.id ? "▼" : "▶"}
              </span>
            </button>
            {openId === faq.id && (
              <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <span className="text-xs font-medium text-legal-accent dark:text-amber-400">{faq.category}</span>
                <p className="mt-1 whitespace-pre-wrap">{faq.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
