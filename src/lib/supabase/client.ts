import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type { Database };

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient<Database>(url, key);
}
