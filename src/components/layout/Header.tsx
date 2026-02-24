"use client";

import Link from "next/link";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";

export function Header() {
  const supabase = useSupabase();
  const { user, signOut } = useAuth(supabase);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 dark:bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-700">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-legal-dark dark:text-slate-100">
          <span className="text-xl">⚖️</span>
          <span>InfoLegal RD</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/#faqs" className="text-slate-600 hover:text-legal-dark dark:text-slate-300 dark:hover:text-white">
            FAQs
          </Link>
          <Link href="/plantillas" className="text-slate-600 hover:text-legal-dark dark:text-slate-300 dark:hover:text-white">
            Plantillas
          </Link>
          {user ? (
            <>
              <span className="text-sm text-slate-500 dark:text-slate-400 max-w-[120px] truncate" title={user.email}>
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                Cerrar sesión
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-legal-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 dark:bg-primary-600"
            >
              Iniciar sesión
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
