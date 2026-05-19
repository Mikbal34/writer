/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Backfill auto-resume: the contextual-backfill loop lives in
 * module memory inside the Next process, so every container
 * restart (deploy, crash, OOM) wipes it. Without this hook,
 * every push during active development means we lose the loop
 * until someone manually re-POSTs /api/library/backfill-contextual.
 *
 * The loop itself is idempotent — it only touches rows with
 * `contextualPrefix IS NULL` or `summary IS NULL` — so kicking
 * it back on at boot can never double-process anything. If the
 * DB shows zero pending work, it exits immediately.
 *
 * Opt-in via env var so dev / staging clusters don't burn API
 * budget the first time someone runs the app locally:
 *   BACKFILL_AUTO_RESUME=1
 *
 * Set in Railway production to keep the loop sticky across pushes.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BACKFILL_AUTO_RESUME !== "1") return;
  try {
    // Late import — instrumentation runs before the rest of the
    // app is wired up, so we avoid touching Prisma at module-eval
    // time (it pulls in the DB pool).
    const { startBackfill } = await import("./lib/backfill-runner");
    // 5 s delay so DB pool + env are fully ready before we
    // start hammering them.
    setTimeout(() => {
      try {
        const started = startBackfill();
        console.log(
          `[instrumentation] backfill auto-resume ${started ? "kicked off" : "already running"}`,
        );
      } catch (err) {
        console.warn("[instrumentation] backfill auto-resume failed:", err);
      }
    }, 5_000);
  } catch (err) {
    console.warn("[instrumentation] register failed:", err);
  }
}
