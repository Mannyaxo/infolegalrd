"use client";

import { createContext, useContext, useMemo } from "react";
import { createClient, type SupabaseClient } from "@/lib/supabase/client";

const Context = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  return <Context.Provider value={client}>{children}</Context.Provider>;
}

export function useSupabase() {
  const client = useContext(Context);
  return client;
}
