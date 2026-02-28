/**
 * Dispara la ejecución del worker de enriquecimiento (enrich:queue --once --force) en segundo plano.
 * Se llama tras encolar una consulta para que el sistema busque/verifique/ingiera automáticamente.
 * En entornos serverless (Vercel) el proceso puede no completarse; usar AUTO_RUN_ENRICH_QUEUE=false para desactivar.
 */
import { spawn } from "child_process";

const ENV_KEY = "AUTO_RUN_ENRICH_QUEUE";

/**
 * Ejecuta `npm run enrich:queue -- --once --force` sin bloquear.
 * No espera al resultado; el proceso se lanza detached para no retrasar la respuesta.
 * Desactivar en Vercel/serverless con AUTO_RUN_ENRICH_QUEUE=false si el proceso no llega a completarse.
 */
export function triggerEnrichRunOnce(): void {
  if (process.env[ENV_KEY] === "false" || process.env[ENV_KEY] === "0") {
    return;
  }
  try {
    const child = spawn("npm", ["run", "enrich:queue", "--", "--once", "--force"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    child.unref();
    console.log("[enrich] Lanzado worker en segundo plano: enrich:queue --once --force");
  } catch (e) {
    console.warn("[enrich] No se pudo lanzar el worker:", e instanceof Error ? e.message : e);
  }
}
