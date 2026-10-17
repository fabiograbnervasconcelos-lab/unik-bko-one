import { NextResponse } from "next/server";
import { requireSession } from "@/lib/mailing/session";
import { sellerTransferBlock, queueCounts } from "@/lib/mailing/queues";
import { loadLeads } from "@/lib/mailing/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireSession();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const leads = loadLeads();
  const counts =
    user.role === "vendedor"
      ? queueCounts(
          leads.filter((l) => l.assignedTo === user.id),
          user.id,
        )
      : queueCounts(leads);
  const block = user.role === "vendedor" ? sellerTransferBlock(user.id) : { blocked: false };
  return NextResponse.json({ user, counts, block });
}
