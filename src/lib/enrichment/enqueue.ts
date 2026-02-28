import { getSupabaseServer } from "@/lib/supabase/server";
import { triggerEnrichRunOnce } from "./triggerEnrichRun";

/**
 * Encola una consulta en corpus_enrichment_queue para enriquecimiento (búsqueda + verificación en fuentes oficiales).
 * Tras encolar, dispara automáticamente el worker (npm run enrich:queue -- --once --force) en segundo plano.
 * No bloquea la respuesta si falla el insert. Para desactivar el lanzamiento automático: AUTO_RUN_ENRICH_QUEUE=false.
 */
export async function enqueueForEnrichment(
  message: string,
  mode: "normal" | "max-reliability"
): Promise<void> {
  if (!message?.trim()) return;
  const supabase = getSupabaseServer();
  if (!supabase) return;
  const now = new Date().toISOString();
  try {
    await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } })
      .from("corpus_enrichment_queue")
      .insert({ query: message.trim(), mode, status: "PENDING", created_at: now });
    console.log("Encolada consulta para enriquecimiento:", message.slice(0, 80) + (message.length > 80 ? "…" : ""));
    triggerEnrichRunOnce();
  } catch {
    // no bloquear la respuesta
  }
}
