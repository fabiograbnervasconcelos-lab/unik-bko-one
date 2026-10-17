import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/mailing/auth";
import { filterLeads, moveLeadQueue, queueCounts } from "@/lib/mailing/queues";
import { loadLeads, loadUsers } from "@/lib/mailing/store";
import type { QueueStatus } from "@/lib/mailing/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const url = new URL(request.url);
  const queue = (url.searchParams.get("queue") || "all") as QueueStatus | "all";
  const search = url.searchParams.get("search") || "";
  const sellerId = url.searchParams.get("sellerId");

  const leads = filterLeads({
    queue,
    search,
    sellerId,
    forUserId: user.id,
    forRole: user.role,
  });

  const all = loadLeads();
  const counts =
    user.role === "vendedor"
      ? queueCounts(
          all.filter((l) => l.assignedTo === user.id),
          user.id,
        )
      : queueCounts(all);

  const sellers = loadUsers()
    .filter((u) => u.active && (u.role === "vendedor" || u.role === "admin"))
    .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role }));

  return NextResponse.json({ leads, counts, sellers });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    leadId?: string;
    queue?: QueueStatus;
  } | null;

  if (!body?.leadId || !body.queue) {
    return NextResponse.json({ error: "leadId e queue são obrigatórios." }, { status: 400 });
  }

  try {
    const lead = await moveLeadQueue({
      leadId: body.leadId,
      queue: body.queue,
      actorId: user.id,
      actorRole: user.role,
    });
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
