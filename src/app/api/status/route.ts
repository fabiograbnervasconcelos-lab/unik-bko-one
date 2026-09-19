import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/paths";
import { loadSettings } from "@/lib/settings";
import { getSnapshot } from "@/lib/store";
import { listVendorSessions, vendorSessionCount } from "@/lib/vendor-session";

export const dynamic = "force-dynamic";

function readDebugTail(limit = 80) {
  try {
    const file = path.join(DATA_DIR, "debug-fatura.ndjson");
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

export async function GET() {
  const settings = loadSettings();
  const snapshot = getSnapshot();
  return NextResponse.json({
    ...snapshot,
    qrDataUrl: undefined,
    hasQr: Boolean(snapshot.qrDataUrl),
    settings,
    deploy: {
      gitSha: (
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        process.env.GIT_SHA ||
        process.env.BUILD_SHA ||
        "local"
      ).slice(0, 12),
      faturaOpcao6: true as const,
      debugFatura: true as const,
      timezone: "America/Sao_Paulo",
    },
    vendorBot: {
      loggedIn: vendorSessionCount(),
      sessions: listVendorSessions(),
    },
    debugFatura: readDebugTail(100),
  });
}
