"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/SupabaseProvider";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const supabase = useSupabase();
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setMessage({ type: "error", text: "Servicio no disponible. Configura Supabase." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ type: "ok", text: "Revisa tu correo para confirmar la cuenta (si está habilitado en tu proyecto)." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
        return;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar sesión o registrarse.";
      setMessage({ type: "error", text: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-legal-dark dark:text-white">
        {isSignUp ? "Crear cuenta" : "Iniciar sesión"}
      </h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Cuenta gratuita: 5 consultas al día. Suscripción $4/mes para consultas ilimitadas.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Correo
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-legal-dark focus:outline-none focus:ring-1 focus:ring-legal-dark dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            placeholder="tu@correo.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-legal-dark focus:outline-none focus:ring-1 focus:ring-legal-dark dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        {message && (
          <p
            className={`text-sm ${message.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
          >
            {message.text}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-legal-dark py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-primary-600"
        >
          {loading ? "Espera..." : isSignUp ? "Registrarme" : "Entrar"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
        {isSignUp ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?"}{" "}
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setMessage(null); }}
          className="font-medium text-legal-dark dark:text-primary-400 hover:underline"
        >
          {isSignUp ? "Iniciar sesión" : "Registrarme"}
        </button>
      </p>
      <p className="mt-6 text-center">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          ← Volver al inicio
        </Link>
      </p>
    </div>
  );
}
