import { NextResponse } from "next/server";
import { login } from "@/lib/mailing/auth";
import { setSessionCookie } from "@/lib/mailing/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    password?: string;
  } | null;
  const username = body?.username?.trim() || "";
  const password = body?.password || "";
  if (!username || !password) {
    return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  }
  const user = await login(username, password);
  if (!user) {
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }
  const response = NextResponse.json({ user });
  return setSessionCookie(response, user);
}
