/**
 * Verificación de la función RPC match_vigente_chunks (RAG).
 * Uso: npm run verify:rag
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Lógica: obtiene un embedding real de un chunk vigente, llama al RPC con ese
 * embedding y exige >= 1 fila. No usa vector de ceros (daría 0 filas aunque todo esté bien).
 */
import { resolve } from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

function fail(msg: string): never {
  console.error("[verify:rag]", msg);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  }

  const supabase = createClient(url, key);

  // 1) Traer un embedding real de un chunk vigente (embedding not null)
  const { data: vigenteIds, error: vigenteErr } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("status", "VIGENTE")
    .limit(500);

  if (vigenteErr) {
    fail("No se pudieron listar versiones VIGENTE: " + vigenteErr.message);
  }
  const ids = (vigenteIds ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    fail("No hay instrument_versions con status=VIGENTE. Ejecuta ingest (ej. npm run ingest:manual -- --all).");
  }

  const { data: seed, error: seedErr } = await supabase
    .from("instrument_chunks")
    .select("embedding, instrument_version_id")
    .in("instrument_version_id", ids)
    .not("embedding", "is", null)
    .limit(1)
    .maybeSingle();

  if (seedErr) {
    fail("Error al obtener un chunk con embedding: " + seedErr.message);
  }
  if (!seed?.embedding) {
    fail(
      "No hay chunks con embedding para versiones VIGENTE. Ejecuta ingest (ej. npm run ingest:manual -- --all)."
    );
  }

  // 2) Llamar RPC con ese embedding
  const { data: rows, error: rpcErr } = await supabase.rpc("match_vigente_chunks", {
    query_embedding: seed.embedding as number[],
    match_count: 5,
  });

  if (rpcErr) {
    fail("La función match_vigente_chunks no existe o falló: " + (rpcErr.message ?? "") + (rpcErr.details ? " " + rpcErr.details : ""));
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    fail(
      "RPC existe pero no devuelve resultados; revisar status=VIGENTE y embeddings (instrument_chunks con embedding no nulo para versiones vigentes)."
    );
  }

  console.log("[verify:rag] OK: match_vigente_chunks existe y devolvió", rows.length, "fila(s).");
}

main().catch((e) => {
  console.error("[verify:rag]", e);
  process.exit(1);
});
