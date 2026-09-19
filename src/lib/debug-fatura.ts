import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { log } from "@/lib/store";

const DEBUG_LOG_LOCAL = "/opt/cursor/logs/debug.log";
const DEBUG_LOG_DATA = path.join(DATA_DIR, "debug-fatura.ndjson");

/** Temporary NDJSON debug logger for option-6 / fatura investigation. */
export function dbgFatura(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
) {
  const payload = {
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || "local",
  };
  const line = JSON.stringify(payload);
  // #region agent log
  try {
    fs.appendFileSync(DEBUG_LOG_LOCAL, line + "\n");
  } catch {
    // local path may not exist on Railway
  }
  try {
    ensureDataDirs();
    fs.appendFileSync(DEBUG_LOG_DATA, line + "\n");
  } catch {
    // ignore volume write failures
  }
  try {
    console.log(`[DBG-FATURA] ${line}`);
  } catch {
    // ignore
  }
  try {
    log("info", `[DBG-FATURA][${hypothesisId}] ${message} ${JSON.stringify(data).slice(0, 300)}`);
  } catch {
    // ignore
  }
  // #endregion
}
