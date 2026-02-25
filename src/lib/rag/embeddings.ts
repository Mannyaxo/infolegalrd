/**
 * Embeddings para RAG. Usa OpenAI text-embedding-3-small (1536 dims).
 */
import OpenAI from "openai";

const MODEL = "text-embedding-3-small";

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const openai = new OpenAI({ apiKey });
  const r = await openai.embeddings.create({
    model: MODEL,
    input: text.slice(0, 8000),
  });
  return r.data[0]?.embedding ?? [];
}
