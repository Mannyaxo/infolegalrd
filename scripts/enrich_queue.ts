/**
 * Worker: procesa corpus_enrichment_queue (PENDING → FETCHING → verificación OpenAI → ingest ley + reglamentos).
 * Busca en consultoria.gov.do y gacetaoficial.gob.do; verifica solo con OpenAI; si hay ley XX-XX, busca e ingesta reglamentos también.
 *
 * Uso: npm run enrich:queue [-- --once] [--limit N] [--dry-run] [--force]
 * Env: FIRECRAWL_API_KEY, SUPABASE_*, OPENAI_API_KEY
 */
import "dotenv/config";
import { resolve } from "path";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  normalizeText,
  sha256,
  deriveCanonicalFromTitle,
  extractPublishedDate,
  ensureConsultoriaSourceId,
  upsertInstrument,
  ingestVersionAndChunks,
} from "./_consultoria_pipeline";
import {
  searchAndDownloadLaw,
  searchAndDownloadLawCandidates,
  verifyWithMultipleAIs,
} from "../src/lib/enrichment/enrich";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

type QueueRow = {
  id: string;
  query: string;
  mode: string | null;
  status: string;
  source_url: string | null;
  title: string | null;
  canonical_key: string | null;
  content_hash: string | null;
  meta: Record<string, unknown>;
  error: string | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 5;
  return { once, dryRun, force, limit: isNaN(limit) ? 5 : Math.max(1, limit) };
}

async function processOne(
  supabase: SupabaseClient,
  openai: OpenAI,
  firecrawlKey: string,
  row: QueueRow,
  dryRun: boolean,
  force: boolean
): Promise<void> {
  const id = row.id;
  const updateStatus = async (status: string, updates: Record<string, unknown> = {}) => {
    if (dryRun) {
      console.log("   [dry-run] would set status", status, updates);
      return;
    }
    await supabase
      .from("corpus_enrichment_queue")
      .update({ status, updated_at: new Date().toISOString(), ...updates })
      .eq("id", id);
  };

  await updateStatus("FETCHING");

  let best: { url: string; title: string; markdown: string } | null;
  try {
    best = await searchAndDownloadLaw(row.query, firecrawlKey);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await updateStatus("FAILED", { error: errMsg });
    return;
  }

  if (!best) {
    await updateStatus("FETCHED_REVIEW", { meta: { ...(row.meta || {}), note: "no_candidate_from_official_domains" } });
    return;
  }

  // Verificación solo OpenAI (GPT-4o-mini): debe responder YES
  const verification = await verifyWithMultipleAIs(best.markdown, best.title, row.query, {
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  });
  if (!verification.verified) {
    const errDetail = `Verificación OpenAI no superada (${verification.votes}/${verification.total}). ${verification.details.join("; ")}`;
    await updateStatus("FAILED", { error: errDetail, meta: { ...(row.meta || {}), verification: verification.details } });
    return;
  }

  const contentText = normalizeText(best.markdown);
  const contentHash = sha256(contentText);
  const { canonical_key, type, number } = deriveCanonicalFromTitle(best.title, best.url);
  const published = extractPublishedDate(best.markdown, { description: undefined }) ?? new Date().toISOString().slice(0, 10);

  if (dryRun) {
    console.log("   [dry-run] would ingest:", canonical_key, best.url, "chunks from content length", contentText.length);
    await updateStatus("INGESTED", {
      source_url: best.url,
      title: best.title,
      canonical_key,
      content_hash: contentHash,
      meta: { ...(row.meta || {}), note: "dry-run" },
    });
    return;
  }

  const sourceId = await ensureConsultoriaSourceId(supabase);
  if (!sourceId) {
    await updateStatus("FAILED", { error: "No ConsultoriaGovDo source id" });
    return;
  }

  const { data: existingByHash } = await supabase
    .from("instrument_versions")
    .select("id")
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();
  if (existingByHash?.id && !force) {
    await updateStatus("INGESTED", {
      source_url: best.url,
      title: best.title,
      canonical_key,
      content_hash: contentHash,
      meta: { ...(row.meta || {}), note: "dedup-by-hash" },
    });
    return;
  }

  await updateStatus("INGESTING", { source_url: best.url, title: best.title, canonical_key, content_hash: contentHash });

  const upsert = await upsertInstrument(supabase, canonical_key, best.title, type, number);
  if ("error" in upsert) {
    await updateStatus("FAILED", { error: upsert.error });
    return;
  }

  const result = await ingestVersionAndChunks(supabase, openai, {
    instrumentId: upsert.instrumentId,
    sourceId,
    sourceUrl: best.url,
    contentText,
    contentHash,
    publishedDate: published,
    canonicalKey: canonical_key,
  });

  if (result.ok) {
    const meta: Record<string, unknown> = { ...(row.meta || {}), versionId: result.versionId, chunksCount: result.chunksCount };
    let reglamentosIngested = 0;

    // Si la consulta menciona una ley (ej. ley 10-07), buscar e ingestar reglamentos asociados
    const lawMatch = row.query.match(/ley\s*(\d{2,3}-\d{2})/i);
    if (lawMatch && !dryRun) {
      const lawNum = lawMatch[1];
      try {
        const reglamentos = await searchAndDownloadLawCandidates(
          `reglamento ley ${lawNum}`,
          firecrawlKey,
          5
        );
        for (const reg of reglamentos) {
          const ver = await verifyWithMultipleAIs(reg.markdown, reg.title, `reglamento ley ${lawNum}`, {
            openaiApiKey: process.env.OPENAI_API_KEY ?? null,
          });
          if (!ver.verified) continue;
          const regText = normalizeText(reg.markdown);
          const regHash = sha256(regText);
          const { canonical_key: regKey, type: regType, number: regNum } = deriveCanonicalFromTitle(reg.title, reg.url);
          const regPublished = extractPublishedDate(reg.markdown, undefined) ?? new Date().toISOString().slice(0, 10);
          const { data: existingReg } = await supabase
            .from("instrument_versions")
            .select("id")
            .eq("content_hash", regHash)
            .limit(1)
            .maybeSingle();
          if (existingReg?.id && !force) continue;
          const regUpsert = await upsertInstrument(supabase, regKey, reg.title, regType, regNum);
          if ("error" in regUpsert) continue;
          const regResult = await ingestVersionAndChunks(supabase, openai, {
            instrumentId: regUpsert.instrumentId,
            sourceId,
            sourceUrl: reg.url,
            contentText: regText,
            contentHash: regHash,
            publishedDate: regPublished,
            canonicalKey: regKey,
          });
          if (regResult.ok) {
            reglamentosIngested++;
            console.log("   Reglamento ingerido:", regKey, reg.title.slice(0, 50));
          }
        }
      } catch (e) {
        console.warn("   Error buscando reglamentos:", e instanceof Error ? e.message : String(e));
      }
      if (reglamentosIngested > 0) meta.reglamentosIngested = reglamentosIngested;
    }

    await updateStatus("INGESTED", { meta });
  } else if (result.skipped === "dedup-by-hash") {
    await updateStatus("INGESTED", { meta: { ...(row.meta || {}), note: "dedup-by-hash" } });
  } else {
    await updateStatus("FAILED", { error: result.error });
  }
}

async function main() {
  const { once, dryRun, force, limit } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!firecrawlKey) {
    console.error("Falta FIRECRAWL_API_KEY (worker usa Firecrawl search para consultoria.gov.do)");
    process.exit(1);
  }
  if (!openaiKey) {
    console.error("Falta OPENAI_API_KEY (embeddings en pipeline)");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  if (dryRun) console.log("Modo dry-run: no se escriben cambios en BD ni se ingesta.");

  const loop = async (): Promise<void> => {
    const { data: rows, error } = await supabase
      .from("corpus_enrichment_queue")
      .select("id, query, mode, status, source_url, title, canonical_key, content_hash, meta, error")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("Error leyendo cola:", error.message);
      return;
    }
    if (!rows?.length) {
      console.log("Sin filas PENDING.");
      return;
    }

    for (const row of rows as QueueRow[]) {
      console.log("Procesando:", row.id, row.query.slice(0, 50) + "...");
      await processOne(supabase, openai, firecrawlKey, row, dryRun, force);
    }

    if (!once) {
      await new Promise((r) => setTimeout(r, 2000));
      return loop();
    }
  };

  await loop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
