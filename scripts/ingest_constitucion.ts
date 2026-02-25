/**
 * Ingesta piloto: Constitución RD.
 * Uso: npm run ingest:constitucion (o npx tsx scripts/ingest_constitucion.ts)
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";
const CONSTITUCION_CANONICAL_KEY = "CONSTITUCION-RD";

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

async function getPdfText(): Promise<string> {
  const url = process.env.CONSTITUCION_SOURCE_URL;
  const localPath = join(process.cwd(), "documents", "constitucion", "constitucion.pdf");

  if (existsSync(localPath)) {
    const pdfParse = (await import("pdf-parse")).default;
    const dataBuffer = readFileSync(localPath);
    const data = await pdfParse(dataBuffer);
    return data?.text ?? "";
  }

  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch PDF failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(Buffer.from(arrayBuffer));
    return data?.text ?? "";
  }

  throw new Error(
    "No PDF source. Coloca documents/constitucion/constitucion.pdf o define CONSTITUCION_SOURCE_URL en .env.local"
  );
}

async function getEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return r.data[0]?.embedding ?? [];
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  if (!openaiKey) {
    console.error("Falta OPENAI_API_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey) as SupabaseClient;
  const openai = new OpenAI({ apiKey: openaiKey });

  console.log("Extrayendo texto del PDF...");
  let rawText: string;
  try {
    rawText = await getPdfText();
  } catch (e) {
    console.error("Error extrayendo PDF:", e);
    process.exit(1);
  }

  const contentText = normalizeText(rawText);
  const contentHash = sha256(contentText);
  const publishedDate =
    process.env.CONSTITUCION_PUBLISHED_DATE || new Date().toISOString().slice(0, 10);
  const sourceUrl = process.env.CONSTITUCION_SOURCE_URL || "local-file";

  console.log("Source e instrument...");
  let finalSourceId: string | null = null;
  const { data: existingSource } = await supabase
    .from("sources")
    .select("id")
    .eq("base_url", sourceUrl)
    .limit(1)
    .maybeSingle();
  if (existingSource?.id) {
    finalSourceId = existingSource.id;
  } else {
    const { data: inserted } = await supabase
      .from("sources")
      .insert({ name: "Constitución RD (fuente inicial)", base_url: sourceUrl })
      .select("id")
      .single();
    finalSourceId = inserted?.id ?? null;
  }

  const { data: instrument } = await supabase
    .from("instruments")
    .select("id")
    .eq("canonical_key", CONSTITUCION_CANONICAL_KEY)
    .maybeSingle();
  let instrumentId = instrument?.id;
  if (!instrumentId) {
    const { data: inserted } = await supabase
      .from("instruments")
      .insert({
        canonical_key: CONSTITUCION_CANONICAL_KEY,
        type: "constitucion",
        number: null,
        title: "Constitución de la República Dominicana",
      })
      .select("id")
      .single();
    instrumentId = inserted?.id ?? null;
  }
  if (!instrumentId) throw new Error("Instrument CONSTITUCION-RD no encontrado");

  const { data: existingVersion } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("content_hash", contentHash)
    .maybeSingle();

  let versionId: string;
  if (existingVersion?.id) {
    console.log("Versión con mismo content_hash ya existe, reutilizando.");
    versionId = existingVersion.id;
  } else {
    await supabase
      .from("instrument_versions")
      .update({ status: "DEROGADA" })
      .eq("instrument_id", instrumentId)
      .eq("status", "VIGENTE");

    const { data: newVersion, error: verErr } = await supabase
      .from("instrument_versions")
      .insert({
        instrument_id: instrumentId,
        source_id: finalSourceId,
        published_date: publishedDate,
        effective_date: null,
        status: "VIGENTE",
        source_url: sourceUrl,
        gazette_ref: null,
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

  const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`Generando embeddings para ${chunks.length} chunks...`);

  const existingChunks = await supabase
    .from("instrument_chunks")
    .select("id")
    .eq("instrument_version_id", versionId);
  if (existingChunks.data && existingChunks.data.length > 0) {
    console.log("Chunks ya existen para esta versión. Eliminando y reinsertando.");
    await supabase.from("instrument_chunks").delete().eq("instrument_version_id", versionId);
  }

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(openai, chunks[i]);
    await supabase.from("instrument_chunks").insert({
      instrument_version_id: versionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${chunks.length}`);
  }

  console.log("Ingesta finalizada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
