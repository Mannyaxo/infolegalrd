import "dotenv/config";
import dotenv from "dotenv";
import { resolve, join, dirname, basename } from "path";
import { readFileSync, existsSync, readdirSync } from "fs";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Ingesta manual en batch para corpus legal (RAG).
 * Env: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * Uso:
 *   npm run ingest:manual -- --all
 *   npm run ingest:manual -- --files "documents/constitucion/constitucion.txt,documents/Ley 41-08/41-08.txt"
 *   npm run ingest:manual -- --all --published 2010-01-26 --source_url "https://consultoria.gov.do/"
 *
 * Opciones:
 *   --all                    Ingestar todos los .txt bajo documents/
 *   --files "path1,path2"    Lista de rutas separadas por coma
 *   --published YYYY-MM-DD   Fecha de promulgación (default: hoy)
 *   --source_url URL         Default: "manual-ingest"
 *   --status VIGENTE        Default: VIGENTE
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createHash } from "crypto";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";
const DOCUMENTS_DIR = "documents";

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

function collectTxtFiles(rootDir: string): string[] {
  const out: string[] = [];
  const absRoot = resolve(process.cwd(), rootDir);
  if (!existsSync(absRoot)) return out;
  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".txt")) out.push(full);
    }
  }
  walk(absRoot);
  return out;
}

/**
 * Deriva canonical_key y title desde la ruta del archivo.
 * Ej: documents/constitucion/constitucion.txt → CONSTITUCION-RD, "Constitución..."
 *     documents/Ley 41-08 Función Pública/41-08.txt → LEY-41-08, "Ley 41-08 Función Pública"
 */
function deriveMetadata(filePath: string): { canonical_key: string; title: string; type: string; number: string | null } {
  const normalized = filePath.replace(/\\/g, "/");
  const parentDir = basename(dirname(normalized));
  const fileName = basename(normalized, ".txt");

  if (/constitucion/i.test(normalized) || /constitucion/i.test(parentDir)) {
    return {
      canonical_key: "CONSTITUCION-RD",
      title: "Constitución de la República Dominicana",
      type: "constitucion",
      number: null,
    };
  }

  const leyMatch = parentDir.match(/(?:Ley|LEY)\s*(\d{2,3}-\d{2})/i);
  const decretoMatch = parentDir.match(/Decreto\s*(\d{2,3}-\d{2})/i);
  const codigoMatch = parentDir.match(/Ley\s*(\d{2}-\d{2})/i);

  if (decretoMatch) {
    const num = decretoMatch[1];
    return {
      canonical_key: `DECRETO-${num}`,
      title: parentDir,
      type: "decreto",
      number: num,
    };
  }
  if (leyMatch) {
    const num = leyMatch[1];
    return {
      canonical_key: `LEY-${num}`,
      title: parentDir,
      type: "ley",
      number: num,
    };
  }
  if (codigoMatch) {
    const num = codigoMatch[1];
    return {
      canonical_key: `LEY-${num}`,
      title: parentDir,
      type: "ley",
      number: num,
    };
  }

  const fileNum = fileName.match(/^(\d{2,3}-\d{2})$/);
  if (fileNum) {
    return {
      canonical_key: `LEY-${fileNum[1]}`,
      title: parentDir,
      type: "ley",
      number: fileNum[1],
    };
  }

  const key = fileName.replace(/_/g, "-").toUpperCase();
  return {
    canonical_key: key || "MANUAL",
    title: parentDir,
    type: "ley",
    number: null,
  };
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

async function ingestOne(
  supabase: ReturnType<typeof createClient>,
  openai: OpenAI,
  filePath: string,
  opts: { published: string; status: string; source_url: string }
): Promise<void> {
  const rawText = readFileSync(filePath, "utf-8");
  const contentText = normalizeText(rawText);
  const contentHash = sha256(contentText);
  const { canonical_key, title, type, number } = deriveMetadata(filePath);

  let sourceId: string | null = null;
  const { data: existingSource } = await supabase
    .from("sources")
    .select("id")
    .eq("name", "ManualUpload")
    .eq("base_url", "manual://")
    .limit(1)
    .maybeSingle();
  if (existingSource?.id) {
    sourceId = existingSource.id;
  } else {
    const { data: inserted, error: errInsert } = await supabase
      .from("sources")
      .insert({ name: "ManualUpload", base_url: "manual://" })
      .select("id")
      .single();
    if (errInsert || !inserted?.id) {
      throw new Error("No se pudo crear source ManualUpload: " + (errInsert?.message ?? ""));
    }
    sourceId = inserted.id;
  }

  let instrumentId: string | null = null;
  const { data: instrument } = await supabase
    .from("instruments")
    .select("id")
    .eq("canonical_key", canonical_key)
    .maybeSingle();
  if (instrument?.id) {
    instrumentId = instrument.id;
    await supabase.from("instruments").update({ type, number: number ?? undefined, title }).eq("id", instrumentId);
  } else {
    const { data: inserted } = await supabase
      .from("instruments")
      .insert({ canonical_key, type, number: number ?? undefined, title })
      .select("id")
      .single();
    instrumentId = inserted?.id ?? null;
  }
  if (!instrumentId) throw new Error("No se pudo obtener/crear instrument: " + canonical_key);

  const { data: existingVersion } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("content_hash", contentHash)
    .maybeSingle();
  let versionId: string;
  if (existingVersion?.id) {
    console.log("   Versión con mismo content_hash ya existe. Reutilizando:", existingVersion.id);
    versionId = existingVersion.id;
  } else {
    if (opts.status === "VIGENTE") {
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
        published_date: opts.published,
        effective_date: null,
        status: opts.status,
        source_url: opts.source_url,
        gazette_ref: null,
        content_text: contentText,
        content_hash: contentHash,
      })
      .select("id")
      .single();
    if (verErr || !newVersion?.id) {
      throw new Error("Error insertando instrument_version: " + (verErr?.message ?? ""));
    }
    versionId = newVersion.id;
  }

  const { data: existingChunks } = await supabase
    .from("instrument_chunks")
    .select("id")
    .eq("instrument_version_id", versionId);
  if (existingChunks && existingChunks.length > 0) {
    await supabase.from("instrument_chunks").delete().eq("instrument_version_id", versionId);
  }

  const chunks = chunkText(contentText, CHUNK_SIZE, CHUNK_OVERLAP);
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(openai, chunks[i]);
    await supabase.from("instrument_chunks").insert({
      instrument_version_id: versionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
    if ((i + 1) % 5 === 0) console.log("      chunks", i + 1, "/", chunks.length);
  }
  console.log("   OK", canonical_key, "→ versión", versionId, "(", chunks.length, "chunks )");
}

async function main() {
  const args = parseArgs();
  const useAll = args["all"] !== undefined;
  const filesArg = args["files"];
  const published = args["published"] ?? new Date().toISOString().slice(0, 10);
  const status = (args["status"] ?? "VIGENTE").toUpperCase();
  const sourceUrl = args["source_url"] ?? "manual-ingest";

  let fileList: string[] = [];
  if (useAll) {
    fileList = collectTxtFiles(DOCUMENTS_DIR);
    console.log("Modo --all: encontrados", fileList.length, "archivos .txt en", DOCUMENTS_DIR);
  } else if (filesArg) {
    fileList = filesArg.split(",").map((p) => p.trim()).filter(Boolean);
  }
  if (fileList.length === 0) {
    console.error("Usa --all o --files \"path1.txt,path2.txt\". Ejemplo: npm run ingest:manual -- --all");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl) {
    throw new Error("Falta SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL en .env.local");
  }
  if (!serviceKey) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");
  }
  if (!openaiKey) {
    throw new Error("Falta OPENAI_API_KEY en .env.local");
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const opts = { published, status, source_url: sourceUrl };
  for (let i = 0; i < fileList.length; i++) {
    const path = fileList[i].startsWith("/") || /^[A-Za-z]:/.test(fileList[i])
      ? fileList[i]
      : resolve(process.cwd(), fileList[i]);
    if (!existsSync(path)) {
      console.warn("No existe:", path);
      continue;
    }
    console.log("[" + (i + 1) + "/" + fileList.length + "]", path);
    await ingestOne(supabase, openai, path, opts);
  }
  console.log("Listo. Ingestados", fileList.length, "archivos.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
