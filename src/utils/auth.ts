export type Role = 'admin' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// Must stay in sync with the server (auth.ts): lowercase email, nothing else.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
export const EMAIL_MAX = 254;
export const isValidEmail = (v: string) => v.length <= EMAIL_MAX && EMAIL_RE.test(v);
/** Keeps only characters an email can contain, lowercased, as the user types. */
export const sanitizeEmailInput = (v: string) => v.toLowerCase().replace(/[^a-z0-9._%+@-]/g, '').slice(0, EMAIL_MAX);

export const UNAUTHORIZED_EVENT = 'lirika:unauthorized';

/** fetch for /api routes: a 401 anywhere signals the app to show the login screen again. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !input.startsWith('/api/auth/login')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Error inesperado del servidor');
  return data as T;
}

export const authApi = {
  login: (username: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/login', 'POST', { username, password }).then((r) => r.user),
  logout: () => request<{ success: boolean }>('/api/auth/logout', 'POST'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/auth/password', 'POST', { currentPassword, newPassword }),
};

export const adminApi = {
  list: () => request<{ users: AuthUser[] }>('/api/admin/users', 'GET').then((r) => r.users),
  create: (data: { username: string; password: string; role: Role }) =>
    request<{ user: AuthUser }>('/api/admin/users', 'POST', data).then((r) => r.user),
  update: (id: string, data: { role?: Role; active?: boolean; password?: string }) =>
    request<{ user: AuthUser }>(`/api/admin/users/${id}`, 'PATCH', data).then((r) => r.user),
  remove: (id: string) => request<{ success: boolean }>(`/api/admin/users/${id}`, 'DELETE'),
};

// Last signed-in user, so the offline-first app still opens without a connection
const CACHE_KEY = 'lirika_auth_user';

export function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function writeCachedUser(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable
  }
}
