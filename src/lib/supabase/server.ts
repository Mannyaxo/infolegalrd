import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cliente Supabase para uso en servidor (API routes, RAG, etc.).
 * Usa SOLO SUPABASE_SERVICE_ROLE_KEY; no usa anon key (evita fallos por RLS/permisos en RPC).
 * Si falta la key, devuelve null y se loguea un aviso.
 * Configure SUPABASE_SERVICE_ROLE_KEY en Vercel: Production / Preview / Development.
 */
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    if (!url) {
      console.error("[Supabase] Falta NEXT_PUBLIC_SUPABASE_URL en el entorno. RAG y backend requieren esta variable.");
    }
    if (!key) {
      console.error(
        "[Supabase] Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (Vercel). El servidor usa SOLO service role; no uses anon key aquí."
      );
    }
    return null;
  }

  return createSupabaseClient<Database>(url, key);
}
