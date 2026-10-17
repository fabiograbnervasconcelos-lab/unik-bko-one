import { NextResponse } from "next/server";
import {
  canManageUsers,
  createUser,
  getSessionUser,
  listPublicUsers,
  resetUserPassword,
  setUserActive,
} from "@/lib/mailing/auth";
import { publicUser } from "@/lib/mailing/store";
import type { UserRole } from "@/lib/mailing/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  return NextResponse.json({ users: listPublicUsers() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    username?: string;
    password?: string;
    role?: UserRole;
  } | null;

  try {
    const created = await createUser({
      name: body?.name || "",
      username: body?.username || "",
      password: body?.password || "",
      role: body?.role === "admin" ? "admin" : "vendedor",
    });
    return NextResponse.json({ user: publicUser(created) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    active?: boolean;
    password?: string;
  } | null;

  if (!body?.userId) {
    return NextResponse.json({ error: "userId obrigatório." }, { status: 400 });
  }

  try {
    if (typeof body.active === "boolean") {
      const updated = await setUserActive(body.userId, body.active);
      return NextResponse.json({ user: updated ? publicUser(updated) : null });
    }
    if (body.password) {
      const updated = await resetUserPassword(body.userId, body.password);
      return NextResponse.json({ user: updated ? publicUser(updated) : null });
    }
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
