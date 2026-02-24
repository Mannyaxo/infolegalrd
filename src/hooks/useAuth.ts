"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export function useAuth(supabase: ReturnType<typeof import("@/lib/supabase/client").createClient> | null) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user: u } }) => setUser(u ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [supabase]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  return { user, signOut };
}
