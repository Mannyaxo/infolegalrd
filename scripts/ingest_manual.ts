import "dotenv/config";
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Ingesta manual controlada para corpus legal (RAG).
 * Env: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * published_date = fecha de promulgación del instrumento (ej. Constitución RD: 2010-01-26).
 * --effective opcional = effective_date (ej. texto consolidado reforma 2024: 2024-??-??).
 * title puede incluir "(texto consolidado 2024)".
 *
 * Ejemplo Constitución RD (2010 + reforma 2024):
 * npm run ingest:manual -- --type constitucion --canonical CONSTITUCION-RD --title "Constitución de la República Dominicana (texto consolidado 2024)" --published 2010-01-26 --effective 2024-01-01 --status VIGENTE --source_url "https://www.consultoria.gov.do/" --file "./documents/constitucion/constitucion.txt"
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && argv[i + 1] !== undefined) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
  }
  return chunks;
}

async function getEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return r.data[0]?.embedding ?? [];
}

async function main() {
  const args = parseArgs();
  const type = args["type"] ?? "constitucion";
  const canonical = args["canonical"] ?? "CONSTITUCION-RD";
  const title = args["title"] ?? "Constitución de la República Dominicana";
  const number = args["number"] ?? null;
  const published = args["published"] ?? new Date().toISOString().slice(0, 10);
  const status = (args["status"] ?? "VIGENTE").toUpperCase();
  const sourceUrl = args["source_url"] ?? "manual://";
  const gazetteRef = args["gazette_ref"] ?? null;
  const effective = args["effective"] ?? null;
  const filePath = args["file"];

  if (!filePath) {
    console.error("Falta --file (ruta al archivo de texto).");
    process.exit(1);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Falta SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL en el entorno (.env.local)."
    );
  }
  if (!serviceKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (.env.local)."
    );
  }
  if (!openaiKey) {
    throw new Error("Falta OPENAI_API_KEY en el entorno (.env.local).");
  }

  if (!existsSync(filePath)) {
    console.error("No existe el archivo:", filePath);
    process.exit(1);
  }

  const rawText = readFileSync(filePath, "utf-8");
  const contentText = normalizeText(rawText);
  const contentHash = sha256(contentText);

  const supabase = createClient(supabaseUrl, serviceKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  console.log("1) Source ManualUpload...");
  let sourceId: string | null = null;
  const { data: existingSource, error: errSelect } = await supabase
    .from("sources")
    .select("id")
    .eq("name", "ManualUpload")
    .eq("base_url", "manual://")
    .limit(1)
    .maybeSingle();
  if (errSelect) {
    console.error("Supabase error:", errSelect);
    process.exit(1);
  }
  if (existingSource?.id) {
    sourceId = existingSource.id;
  } else {
    const { data: inserted, error: errInsert } = await supabase
      .from("sources")
      .insert({ name: "ManualUpload", base_url: "manual://" })
      .select("id")
      .single();
    if (errInsert) {
      console.error("Supabase error:", errInsert);
      process.exit(1);
    }
    sourceId = inserted?.id ?? null;
  }
  if (!sourceId) {
    console.error("No se pudo obtener/crear source.");
    process.exit(1);
  }

  console.log("2) Instrument", canonical, "...");
  const { data: instrument } = await supabase
    .from("instruments")
    .select("id")
    .eq("canonical_key", canonical)
    .maybeSingle();
  let instrumentId: string | null = instrument?.id ?? null;
  if (!instrumentId) {
    const { data: inserted } = await supabase
      .from("instruments")
      .insert({
        canonical_key: canonical,
        type,
        number,
        title,
      })
      .select("id")
      .single();
    instrumentId = inserted?.id ?? null;
  } else {
    await supabase
      .from("instruments")
      .update({ type, number: number ?? undefined, title })
      .eq("id", instrumentId);
  }
  if (!instrumentId) {
    console.error("No se pudo obtener/crear instrument.");
    process.exit(1);
  }

  console.log("3) Instrument version...");
  const { data: existingVersion } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("content_hash", contentHash)
    .maybeSingle();
  let versionId: string;
  if (existingVersion?.id) {
    console.log("   Versión con mismo content_hash ya existe. Reutilizando.");
    versionId = existingVersion.id;
  } else {
    if (status === "VIGENTE") {
      await supabase
        .from("instrument_versions")
        .update({ status: "DEROGADA" })
        .eq("instrument_id", instrumentId)
        .eq("status", "VIGENTE");
    }
    const { data: newVersion, error: verErr } = await supabase
      .from("instrument_versions")
      .insert({
        instrument_id: instrumentId,
        source_id: sourceId,
        published_date: published,
        effective_date: effective || null,
        status,
        source_url: sourceUrl,
        gazette_ref: gazetteRef,
        content_text: contentText,
        content_hash: contentHash,
      })
      .select("id")
      .single();
    if (verErr || !newVersion?.id) {
      console.error("Error insertando instrument_version:", verErr);
      process.exit(1);
    }
    versionId = newVersion.id;
  }

  const existingChunks = await supabase
    .from("instrument_chunks")
    .select("id")
    .eq("instrument_version_id", versionId);
  if (existingChunks.data && existingChunks.data.length > 0) {
    console.log("   Borrando chunks anteriores de esta versión...");
    await supabase
      .from("instrument_chunks")
      .delete()
      .eq("instrument_version_id", versionId);
  }

  const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log("4) Embeddings y chunks (" + chunks.length + ")...");
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(openai, chunks[i]);
    await supabase.from("instrument_chunks").insert({
      instrument_version_id: versionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
    if ((i + 1) % 5 === 0) console.log("   ", i + 1, "/", chunks.length);
  }
  console.log("Listo. Versión id:", versionId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
