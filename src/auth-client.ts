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
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("登录服务返回了异常响应，请稍后再试");
  }
  const body = await response.json() as T & { error?: string; code?: string; email?: string };
  if (!response.ok) throw new AuthRequestError(body.error || "账号服务暂时不可用", body.code, body.email);
  return body;
}

export class AuthRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly email?: string) {
    super(message);
  }
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

export function register(name: string, email: string, password: string) {
  return authRequest<{ success: true; needsEmailVerification: boolean; email: string }>("register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export function resendVerification(email: string) {
  return authRequest<{ success: true }>("resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function requestPasswordReset(email: string) {
  return authRequest<{ success: true }>("forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyEmail(token: string) {
  return authRequest<{ user: AuthUser }>("verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resetPassword(token: string, password: string) {
  return authRequest<{ user: AuthUser }>("reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function signOut() {
  return authRequest<{ success: true }>("logout", { method: "POST" });
}
