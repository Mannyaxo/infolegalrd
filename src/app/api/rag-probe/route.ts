/**
 * Prueba de recuperación RAG: misma lógica que /api/chat (retrieveVigenteChunks + merge por ley).
 * Sirve para probar qué chunks devuelve el RAG sin enviar a la IA.
 * POST body: { message: string }
 * Response: { ok: true, total: number, chunks: Array<{ title, source_url, canonical_key, chunk_index, textPreview }>, byCanonicalUsed?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  retrieveVigenteChunks,
  retrieveVigenteChunksByCanonicalKey,
  type VigenteChunk,
} from "@/lib/rag/vigente";

const RAG_TOP_K = 8;
const PREVIEW_LEN = 200;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
    }

    let chunks: VigenteChunk[] = [];
    try {
      chunks = await retrieveVigenteChunks(message, RAG_TOP_K);
    } catch (e) {
      console.error("[rag-probe] retrieveVigenteChunks failed:", e);
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "RAG retrieval failed" },
        { status: 500 }
      );
    }

    const askedLaw = message.match(/ley\s*(\d{2,3}-\d{2})/i);
    const askedCanonical = askedLaw ? `LEY-${askedLaw[1]}` : null;
    let byCanonicalUsed = false;
    if (askedCanonical) {
      try {
        const byCanonical = await retrieveVigenteChunksByCanonicalKey(askedCanonical, RAG_TOP_K);
        if (byCanonical.length > 0) {
          const seen = new Set<string>();
          for (const c of byCanonical) {
            seen.add(`${c.citation.source_url ?? ""}|${c.chunk_index}`);
          }
          const rest = chunks.filter((c) => !seen.has(`${c.citation.source_url ?? ""}|${c.chunk_index}`));
          chunks = [...byCanonical, ...rest].slice(0, RAG_TOP_K);
          byCanonicalUsed = true;
        }
      } catch (e) {
        console.warn("[rag-probe] retrieveVigenteChunksByCanonicalKey failed:", e);
      }
    }

    const list = chunks.map((c) => ({
      title: c.citation.title ?? "",
      source_url: c.citation.source_url ?? "",
      canonical_key: c.citation.canonical_key ?? null,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      textPreview: c.chunk_text.slice(0, PREVIEW_LEN) + (c.chunk_text.length > PREVIEW_LEN ? "…" : ""),
    }));

    return NextResponse.json({
      ok: true,
      total: list.length,
      chunks: list,
      byCanonicalUsed: askedCanonical ? byCanonicalUsed : undefined,
      askedCanonical: askedCanonical ?? undefined,
    });
  } catch (e) {
    console.error("[rag-probe]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
