/**
 * Guardrails para el chat legal: solo se rechaza solicitud de actos ilegales,
 * instrucciones paso a paso para delinquir, o representación/resultados garantizados.
 * Las consultas legales normales reciben respuesta con disclaimer previo.
 */

export const REFUSAL_MESSAGE =
  "Esta herramienta no puede ayudar con solicitudes que impliquen actos ilegales, falsificación, evasión fiscal ilícita ni instrucciones para delinquir. Consulte a un abogado colegiado para asuntos legales.";

export const DISCLAIMER_PREFIX =
  "Nota: información general, no asesoría legal profesional.\n\n";

function normalizeForCheck(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Devuelve true solo si el mensaje pide explícitamente:
 * (a) instrucciones para actos ilegales (fraude, falsificación, evasión ilícita),
 * (b) pasos para delinquir,
 * (c) representación legal personalizada o resultados garantizados.
 */
export function shouldRefuseIllegal(userMessage: string): boolean {
  const t = normalizeForCheck(userMessage);
  if (t.length < 10) return false;

  const illegalPatterns = [
    /\bfalsificar\b/,
    /\bfalsear\b/,
    /\b(documento|certificado|firma)\s*(falso|falsificado)/,
    /\bevadir\s*(impuestos|tributos|hacienda|la ley)/i,
    /\bdefraudar\b/,
    /\bfraude\s*(tributario|fiscal)/i,
    /\binstrucciones?\s*para\s*(falsificar|evadir|defraudar)/i,
    /\bc[oó]mo\s*(falsificar|falsear|evadir\s*impuestos)/i,
    /\bpasos?\s*para\s*(falsificar|evadir|defraudar)/i,
    /\bdelinquir\b/,
    /\bcometer\s*(un\s*)?delito\b/,
    /\bhuir\s*(de\s*)?(la\s*)?justicia\b/,
    /\bocultar\s*(bienes|dinero)\s*(a\s*)?(hacienda|autoridades)/i,
    /\brepresentaci[oó]n\s*legal\s*personalizada\b/,
    /\bte\s*garantizo\b|\bgarantizo\s*que\b|\bresultado\s*garantizado\b/,
  ];

  return illegalPatterns.some((re) => re.test(t));
}
