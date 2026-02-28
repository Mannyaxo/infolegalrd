"use client";

/**
 * Renderiza contenido del asistente: si detecta secciones (Marco Legal, Referencias, etc.) las muestra estructuradas; si no, markdown/simple.
 */
export function LegalResponse({ content }: { content: string }) {
  const text = content.trim();
  if (!text) return null;

  const sections = splitSections(text);
  if (sections.length > 0) {
    return (
      <div className="legal-response">
        {sections.map((s, i) => (
          <div key={i} className="legal-response-section">
            <div className="legal-response-heading font-title">{s.title}</div>
            <div className="legal-response-body">{formatParagraphs(s.body)}</div>
          </div>
        ))}
      </div>
    );
  }

  return <div className="legal-response-body">{formatParagraphs(text)}</div>;
}

const SECTION_HEADINGS = [
  /^(\d+[º.)]\s*)?(Marco\s*Legal|Referencias?\s*Normativas?|Orientaci[oó]n|Conclusi[oó]n|Pr[oó]ximos\s*pasos|Base\s*legal)/i,
  /^(\*\*)([^*]+)(\*\*)\s*$/m,
  // Estructura API: "1️⃣ CONCLUSIÓN DIRECTA", "2. BASE LEGAL", "**Fuentes verificadas:**"
  /^.{0,12}(CONCLUSI[OÓ]N\s*DIRECTA|BASE\s*LEGAL|C[OÓ]MO\s*PROCEDER|SI\s*LA\s*INSTITUCI[OÓ]N\s*NO\s*RESPONDE|RIESGOS\s*O\s*PRECAUCIONES|Fuentes\s*verificadas)/i,
  /^(Conclusi[oó]n\s*directa|Base\s*legal|C[oó]mo\s*proceder|Riesgos\s*o\s*precauciones)/i,
];

function splitSections(text: string): { title: string; body: string }[] {
  const lines = text.split(/\n/);
  const out: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    let matched = false;
    for (const re of SECTION_HEADINGS) {
      const m = trimmed.match(re);
      if (m) {
        if (current) out.push(current);
        current = {
          title: (m[2] ?? m[1] ?? m[0]).trim().replace(/^\d+[º.)]\s*/, ""),
          body: "",
        };
        matched = true;
        break;
      }
    }
    if (!matched && current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) out.push(current);
  return out.filter((s) => s.body.trim() || s.title);
}

function formatParagraphs(block: string) {
  const parts = block.split(/\n\n+/);
  return (
    <>
      {parts.map((p, i) => {
        const trimmed = p.trim();
        if (!trimmed) return null;
        if (/^[-*]\s+/m.test(trimmed)) {
          const items = trimmed.split(/\n/).filter(Boolean);
          return (
            <ul key={i} className="legal-response-list">
              {items.map((item, j) => (
                <li key={j}>{item.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        if (/^\d+[.)]\s+/m.test(trimmed)) {
          const items = trimmed.split(/\n/).filter(Boolean);
          return (
            <ol key={i} className="legal-response-list">
              {items.map((item, j) => (
                <li key={j}>{item.replace(/^\d+[.)]\s+/, "")}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className="legal-response-p">
            {trimmed}
          </p>
        );
      })}
    </>
  );
}
