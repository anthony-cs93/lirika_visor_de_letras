import { apiFetch } from './auth';
import { getStorageUserId } from './storage';

export interface SongGroup {
  id: string;
  name: string;
  position: number;
}

export const MAX_GROUPS = 5;
export const GROUP_NAME_MAX = 20;

// Cached per account: every account has its own groups
const cacheKey = () => `lirika_groups_v1:${getStorageUserId() ?? ''}`;

export function readCachedGroups(): SongGroup[] {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? (JSON.parse(raw) as SongGroup[]) : [];
  } catch {
    return [];
  }
}

function writeCachedGroups(groups: SongGroup[]) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(groups));
  } catch {
    // storage unavailable
  }
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

export async function fetchGroups(): Promise<SongGroup[]> {
  const { groups } = await request<{ groups: SongGroup[] }>('/api/groups', 'GET');
  writeCachedGroups(groups);
  return groups;
}

export const groupsApi = {
  create: (name: string) => request<{ group: SongGroup }>('/api/groups', 'POST', { name }).then((r) => r.group),
  rename: (id: string, name: string) =>
    request<{ group: SongGroup }>(`/api/groups/${id}`, 'PATCH', { name }).then((r) => r.group),
  remove: (id: string) => request<{ success: boolean }>(`/api/groups/${id}`, 'DELETE'),
};
