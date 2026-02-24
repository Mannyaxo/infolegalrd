import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Tipos para la base de datos (ajustar según tu schema en Supabase)
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      faqs: {
        Row: { id: string; category: string; question: string; answer: string; created_at: string };
        Insert: { id?: string; category: string; question: string; answer: string; created_at?: string };
        Update: { category?: string; question?: string; answer?: string };
      };
      consultas_diarias: {
        Row: { id: string; user_id: string; fecha: string; cantidad: number };
        Insert: { id?: string; user_id: string; fecha: string; cantidad: number };
        Update: {
          id?: string;
          user_id?: string;
          fecha?: string;
          cantidad?: number;
        };
      };
      usuarios_premium: {
        Row: { id: string; user_id: string; stripe_subscription_id: string | null; activo: boolean };
        Insert: { id?: string; user_id: string; stripe_subscription_id?: string | null; activo?: boolean };
        Update: { stripe_subscription_id?: string | null; activo?: boolean };
      };
    };
  };
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient<Database>(url, key);
}
