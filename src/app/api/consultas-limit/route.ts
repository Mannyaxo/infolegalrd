import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const LIMITE_GRATIS = 5;

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

/** GET: devuelve { permitido: boolean, usadas: number, limite: number } */
export async function GET(request: NextRequest) {
  const HOY = new Date().toISOString().split("T")[0];
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: LIMITE_GRATIS });
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: LIMITE_GRATIS });
  }

  // Comprobar si es premium
  const { data: premium } = await supabase
    .from("usuarios_premium")
    .select("id")
    .eq("user_id", userId)
    .eq("activo", true)
    .maybeSingle();

  if (premium) {
    return NextResponse.json({ permitido: true, usadas: 0, limite: -1 });
  }

  // Contar consultas hoy para este usuario
  const { data: row } = await supabase
    .from("consultas_diarias")
    .select("cantidad")
    .eq("user_id", userId)
    .eq("fecha", HOY)
    .maybeSingle();

  const usadas = (row as { cantidad?: number } | null)?.cantidad ?? 0;
  const permitido = usadas < LIMITE_GRATIS;

  return NextResponse.json({
    permitido,
    usadas,
    limite: LIMITE_GRATIS,
  });
}

/** POST: incrementa el contador de consultas para userId (llamar después de cada chat exitoso) */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Falta userId" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ ok: true });
  }

  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("consultas_diarias")
    .select("id, cantidad")
    .eq("user_id", userId)
    .eq("fecha", today)
    .maybeSingle();
  const existing = data as { id: string; cantidad: number } | null;

  if (existing) {
    await supabase
      .from("consultas_diarias")
      .update({ cantidad: (existing.cantidad ?? 0) + 1 })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("consultas_diarias")
      .insert({
        user_id: userId,
        fecha: today,
        cantidad: 1
      });
  }

  return NextResponse.json({ ok: true });
}
