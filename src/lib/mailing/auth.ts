import { cookies } from "next/headers";
import { hashPassword, newId, signSession, verifyPassword, verifySession } from "@/lib/mailing/crypto";
import { loadUsers, publicUser, updateUsers } from "@/lib/mailing/store";
import type { MailingUser, SessionUser, UserRole } from "@/lib/mailing/types";

export const SESSION_COOKIE = "one_mailing_session";

export async function login(username: string, password: string): Promise<SessionUser | null> {
  const users = loadUsers();
  const user = users.find(
    (item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.active,
  );
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}

export function sessionTokenFor(user: SessionUser) {
  return signSession({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySession(token);
  if (!payload?.id || !payload.username || !payload.role) return null;
  const users = loadUsers();
  const user = users.find((item) => item.id === payload.id && item.active);
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}

export function canManageUsers(role: UserRole) {
  return role === "master" || role === "admin";
}

export function canDistribute(role: UserRole) {
  return role === "master" || role === "admin";
}

export function canScrapePap(role: UserRole) {
  return role === "master" || role === "admin";
}

export async function createUser(input: {
  name: string;
  username: string;
  password: string;
  role: UserRole;
}): Promise<MailingUser> {
  const username = input.username.trim().toLowerCase();
  if (!username || !input.password || !input.name.trim()) {
    throw new Error("Nome, usuário e senha são obrigatórios.");
  }
  if (input.role === "master") {
    throw new Error("Não é permitido criar outro master por aqui.");
  }
  const users = await updateUsers((list) => {
    if (list.some((item) => item.username.toLowerCase() === username)) {
      throw new Error("Já existe um usuário com esse login.");
    }
    const now = new Date().toISOString();
    const user: MailingUser = {
      id: newId("user"),
      name: input.name.trim(),
      username,
      passwordHash: hashPassword(input.password),
      role: input.role,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    return [...list, user];
  });
  return users.find((item) => item.username === username)!;
}

export async function setUserActive(userId: string, active: boolean) {
  const users = await updateUsers((list) =>
    list.map((item) => {
      if (item.id !== userId) return item;
      if (item.role === "master") throw new Error("Master não pode ser desativado.");
      return { ...item, active, updatedAt: new Date().toISOString() };
    }),
  );
  return users.find((item) => item.id === userId) || null;
}

export async function resetUserPassword(
  userId: string,
  password: string,
  opts?: { actorRole?: UserRole },
) {
  if (!password || password.length < 4) throw new Error("Senha muito curta (mín. 4).");
  if (opts?.actorRole && opts.actorRole !== "master") {
    throw new Error("Somente o master pode trocar a senha dos usuários.");
  }
  const users = await updateUsers((list) => {
    const target = list.find((item) => item.id === userId);
    if (!target) throw new Error("Usuário não encontrado.");
    if (target.role === "master") {
      throw new Error("A senha do master não pode ser alterada por aqui.");
    }
    return list.map((item) =>
      item.id === userId
        ? {
            ...item,
            passwordHash: hashPassword(password),
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
  });
  return users.find((item) => item.id === userId) || null;
}

export function listPublicUsers() {
  return loadUsers().map(publicUser);
}
