"use client";

import { useState } from "react";

export type SourceItem = {
  title: string;
  source_url: string;
  similarity?: number;
  textPreview: string;
};

const PREVIEW_LEN = 280;

function similarityColor(similarity: number | undefined): string {
  if (similarity == null) return "var(--muted)";
  if (similarity >= 0.8) return "var(--sage)";
  if (similarity >= 0.65) return "var(--accent)";
  return "var(--muted)";
}

function similarityLabel(similarity: number | undefined): string {
  if (similarity == null) return "—";
  return `${Math.round(similarity * 100)}%`;
}

export function SourcesPanel({ sources }: { sources: SourceItem[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!sources || sources.length === 0) return null;

  return (
    <div
      className="sources-panel"
      style={{
        marginTop: 16,
        padding: "16px 0",
        borderTop: "1px solid var(--border2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          color: "var(--muted)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--sage)" }}>◆</span>
        Fuentes utilizadas
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {sources.map((s, i) => (
          <li
            key={i}
            style={{
              background: "var(--surface2)",
              borderRadius: 10,
              border: "1px solid var(--border2)",
              overflow: "hidden",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                width: "100%",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "none",
                border: "none",
                color: "var(--off-white)",
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }} title={s.title}>
                {s.title || "Sin título"}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color: similarityColor(s.similarity),
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {similarityLabel(s.similarity)}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  color: "var(--muted)",
                  transform: expanded === i ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s ease",
                }}
              >
                ▼
              </span>
            </button>
            {expanded === i && (
              <div
                style={{
                  padding: "0 14px 14px",
                  borderTop: "1px solid var(--border2)",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    paddingTop: 10,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--muted)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {s.textPreview.length > PREVIEW_LEN ? s.textPreview.slice(0, PREVIEW_LEN) + "…" : s.textPreview}
                </p>
                {s.source_url && (
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--sage)",
                      textDecoration: "none",
                    }}
                  >
                    Ver fuente →
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
