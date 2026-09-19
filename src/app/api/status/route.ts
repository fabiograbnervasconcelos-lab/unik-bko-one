import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings";
import { getSnapshot } from "@/lib/store";
import { listVendorSessions, vendorSessionCount } from "@/lib/vendor-session";

export const dynamic = "force-dynamic";

function deployMeta() {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.BUILD_SHA ||
    "local";
  return {
    gitSha: sha.slice(0, 12),
    faturaOpcao6: true as const,
    timezone: "America/Sao_Paulo",
  };
}

export async function GET() {
  const settings = loadSettings();
  const snapshot = getSnapshot();
  return NextResponse.json({
    ...snapshot,
    qrDataUrl: undefined,
    hasQr: Boolean(snapshot.qrDataUrl),
    settings,
    deploy: deployMeta(),
    vendorBot: {
      loggedIn: vendorSessionCount(),
      sessions: listVendorSessions(),
    },
  });
}
