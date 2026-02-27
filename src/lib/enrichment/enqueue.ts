import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Encola una consulta en corpus_enrichment_queue para enriquecimiento (búsqueda + verificación en fuentes oficiales).
 * No bloquea la respuesta si falla el insert.
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
  } catch {
    // no bloquear la respuesta
  }
}
