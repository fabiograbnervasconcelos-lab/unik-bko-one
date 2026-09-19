import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings";
import { getSnapshot } from "@/lib/store";
import { listVendorSessions, vendorSessionCount } from "@/lib/vendor-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = loadSettings();
  const snapshot = getSnapshot();
  return NextResponse.json({
    ...snapshot,
    qrDataUrl: undefined,
    hasQr: Boolean(snapshot.qrDataUrl),
    settings,
    vendorBot: {
      loggedIn: vendorSessionCount(),
      sessions: listVendorSessions(),
    },
  });
}
