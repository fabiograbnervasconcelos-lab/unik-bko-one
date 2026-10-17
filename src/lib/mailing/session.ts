import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionUser, sessionTokenFor } from "@/lib/mailing/auth";
import type { SessionUser } from "@/lib/mailing/types";

export async function requireSession(): Promise<SessionUser | null> {
  return getSessionUser();
}

export function setSessionCookie(response: NextResponse, user: SessionUser) {
  response.cookies.set(SESSION_COOKIE, sessionTokenFor(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function readCookieToken() {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value || null;
}
