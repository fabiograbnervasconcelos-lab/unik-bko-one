export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startBackgroundServices } = await import("@/lib/scheduler");
  startBackgroundServices();
}
