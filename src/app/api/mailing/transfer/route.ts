import { NextResponse } from "next/server";
import { canDistribute, getSessionUser } from "@/lib/mailing/auth";
import { transferLeads } from "@/lib/mailing/queues";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canDistribute(user.role)) {
    return NextResponse.json({ error: "Sem permissão para transferir." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    leadIds?: string[];
    sellerId?: string;
    force?: boolean;
  } | null;

  const leadIds = Array.isArray(body?.leadIds) ? body!.leadIds.filter(Boolean) : [];
  const sellerId = body?.sellerId?.trim() || "";
  const force = Boolean(body?.force) && canDistribute(user.role);
  if (!leadIds.length || !sellerId) {
    return NextResponse.json(
      { error: "Informe leadIds e o vendedor (sellerId)." },
      { status: 400 },
    );
  }

  try {
    const result = await transferLeads({
      leadIds,
      sellerId,
      actorId: user.id,
      force,
    });
    if (result.blocked) {
      return NextResponse.json(
        {
          error: result.blocked.reason,
          blocked: result.blocked,
          transferred: [],
          canForce: canDistribute(user.role),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      transferred: result.transferred,
      count: result.transferred.length,
      forced: force,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
