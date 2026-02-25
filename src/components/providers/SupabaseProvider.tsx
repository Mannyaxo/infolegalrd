"use client";

import { createContext, useContext, useMemo } from "react";
import { createClient, type Database } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const Context = createContext<SupabaseClient<Database> | null>(null);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => createClient(), []);
  if (!client) return null;

  return <Context.Provider value={client}>{children}</Context.Provider>;
}

export function useSupabase() {
  const client = useContext(Context);
  return client;
}
