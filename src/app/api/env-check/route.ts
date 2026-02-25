import { NextResponse } from "next/server";

function present(v: string | undefined) {
  return typeof v === "string" && v.length > 0;
}

export async function GET() {
  // DO NOT expose secrets; only booleans + tiny metadata
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let urlHost: string | null = null;
  if (url) {
    try {
      urlHost = new URL(url).host;
    } catch {
      urlHost = null;
    }
  }

  return NextResponse.json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: present(url),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: present(anon),
      SUPABASE_SERVICE_ROLE_KEY: present(service),
      urlHost,
    },
  });
}
