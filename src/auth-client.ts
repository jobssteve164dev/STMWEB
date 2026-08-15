export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/internal-auth/${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "登录服务暂时不可用");
  return body;
}

export function getSession() {
  return authRequest<{ user: AuthUser | null }>("session");
}

export function signIn(email: string, password: string) {
  return authRequest<{ user: AuthUser }>("login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signOut() {
  return authRequest<{ success: true }>("logout", { method: "POST" });
}
