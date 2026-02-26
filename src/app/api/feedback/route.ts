import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      query?: string;
      response?: string;
      feedback?: string;
      timestamp?: string;
      mode?: string;
      userId?: string | null;
    };

    const query = typeof body.query === "string" ? body.query : "";
    const response = typeof body.response === "string" ? body.response : "";
    const feedback = typeof body.feedback === "string" ? body.feedback : "";
    const createdAt = typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();
    const mode = typeof body.mode === "string" ? body.mode : "standard";
    const userId = typeof body.userId === "string" ? body.userId : null;

    const supabase = getSupabaseServer();
    if (supabase) {
      await (supabase as unknown as { from: (t: string) => { insert: (r: object) => Promise<{ error: unknown }> } }).from(
        "feedback"
      ).insert({
        query,
        response,
        feedback,
        created_at: createdAt,
        mode,
        user_id: userId,
      });
    }

    return NextResponse.json(
      { message: "Feedback recibido, gracias por ayudar a mejorar" },
      { status: 200 }
    );
  } catch (err) {
    console.error("[feedback]", err);
    return NextResponse.json(
      { message: "Error al guardar el feedback" },
      { status: 500 }
    );
  }
}
