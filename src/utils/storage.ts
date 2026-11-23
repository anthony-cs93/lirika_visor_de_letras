import { Song, CloudSyncStatus } from '../types/song';
import { stripChords } from './lyricsParser';
import { apiFetch } from './auth';

const BASE_STORAGE_KEY = 'lirika_songs_v1';
const SETTINGS_KEY = 'lirika_user_settings_v1';
const BASE_LAST_SYNC_KEY = 'lirika_last_sync_timestamp';

// Songs are cached per account, so signing in as someone else never shows (or uploads) another account's songs
let storageUserId: string | null = null;
let storageIsGuest = false;
let STORAGE_KEY = BASE_STORAGE_KEY;
let LAST_SYNC_KEY = BASE_LAST_SYNC_KEY;

export function setStorageUser(user: { id: string; isGuest: boolean } | null) {
  const id = user?.id ?? null;
  if (id === storageUserId) return;
  storageUserId = id;
  storageIsGuest = !!user?.isGuest;
  STORAGE_KEY = id ? `${BASE_STORAGE_KEY}:${id}` : BASE_STORAGE_KEY;
  LAST_SYNC_KEY = id ? `${BASE_LAST_SYNC_KEY}:${id}` : BASE_LAST_SYNC_KEY;
  syncStatusState = { ...syncStatusState, lastSyncAt: localStorage.getItem(LAST_SYNC_KEY) };
}

export const getStorageUserId = () => storageUserId;

/** A device starts with no songs: every account's songs come from the cloud (nothing is carried over from another account). */
const startingSongs = (): Song[] => [];

// Listeners for reactive updates
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(fn => fn());
}

export function subscribeToStore(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Raw store: includes deleted songs (tombstones with deletedAt) so deletions can sync to the cloud
function readAllSongs(): Song[] {
  // No signed-in account yet (or any more): there are no songs to show and none must ever be uploaded
  if (!storageUserId) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First boot of this account on this device: empty until the cloud answers
      const initial = startingSongs();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : startingSongs();
  } catch (err) {
    console.error('Error reading songs from localStorage:', err);
    return startingSongs();
  }
}

function writeAllSongs(songs: Song[]): void {
  if (!storageUserId) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    notify();
  } catch (err) {
    console.error('Error saving songs to localStorage:', err);
  }
}

// Get visible (non-deleted) songs from local storage
export function getLocalSongs(): Song[] {
  return readAllSongs()
    .filter(s => !s.deletedAt)
    .map(s => ({ ...s, lyrics: s.lyrics ? stripChords(s.lyrics) : '' }));
}

// Find single song
export function getSongById(id: string): Song | undefined {
  return getLocalSongs().find(s => s.id === id);
}

// Add or update song
export function upsertSong(song: Song): Song {
  const songs = readAllSongs();
  const existingIdx = songs.findIndex(s => s.id === song.id);
  const now = new Date().toISOString();

  let result: Song;
  let updatedList: Song[];
  if (existingIdx >= 0) {
    result = { ...songs[existingIdx], ...song, updatedAt: now };
    if (result.isMaster) result.metaUpdatedAt = now;
    delete result.deletedAt;
    updatedList = [...songs];
    updatedList[existingIdx] = result;
  } else {
    result = { ...song, createdAt: song.createdAt || now, updatedAt: now };
    if (result.isMaster) result.metaUpdatedAt = now;
    updatedList = [result, ...songs];
  }

  writeAllSongs(updatedList);
  triggerCloudSync();
  return result;
}

// Personal copy of a master song: same id (so at most one per account), now editable. It replaces the master in
// this account's library; deleting the copy brings the master back.
export function makePersonalCopy(id: string): Song | null {
  const songs = readAllSongs();
  const target = songs.find(s => s.id === id && !s.deletedAt);
  if (!target) return null;
  if (!target.isMaster) return target; // already editable (own song or an existing copy)
  const { isMaster: _m, metaUpdatedAt: _t, ...rest } = target;
  const copy: Song = { ...rest, masterId: id, updatedAt: new Date().toISOString() };
  writeAllSongs(songs.map(s => (s === target ? copy : s)));
  triggerCloudSync();
  return copy;
}

// Delete song (soft delete so the deletion reaches the cloud and other devices)
export function deleteSong(id: string): boolean {
  const songs = readAllSongs();
  const target = songs.find(s => s.id === id && !s.deletedAt);
  if (!target) return false;
  const now = new Date().toISOString();
  writeAllSongs(songs.map(s => (s === target ? { ...s, deletedAt: now, updatedAt: now } : s)));
  triggerCloudSync();
  return true;
}

// "Restablecer cancionero": brings back the starter songs this account removed (masters and copies).
// Nothing the account created or edited is touched.
export async function restoreStarterSongs(): Promise<{ success: boolean; restored?: number }> {
  try {
    const res = await apiFetch('/api/songs/restore-starter', { method: 'POST' });
    if (!res.ok) return { success: false };
    const data = await res.json();
    // Forget the local "removed" masters first, or the next sync would hide them again
    writeAllSongs(readAllSongs().filter(s => !(s.isMaster && s.deletedAt)));
    await triggerCloudSync();
    return { success: true, restored: Number(data.restored || 0) };
  } catch {
    return { success: false };
  }
}

// Toggle Favorite
export function toggleFavoriteSong(id: string): boolean {
  const songs = readAllSongs();
  const target = songs.find(s => s.id === id && !s.deletedAt);
  if (!target) return false;
  target.isFavorite = !target.isFavorite;
  target.updatedAt = new Date().toISOString();
  if (target.isMaster) target.metaUpdatedAt = target.updatedAt;
  writeAllSongs(songs);
  triggerCloudSync();
  return !!target.isFavorite;
}

// Add/remove a song from a group (folder)
export function toggleSongGroup(id: string, groupId: string): boolean {
  const songs = readAllSongs();
  const target = songs.find(s => s.id === id && !s.deletedAt);
  if (!target) return false;
  const current = target.groupIds ?? [];
  const inGroup = current.includes(groupId);
  target.groupIds = inGroup ? current.filter(g => g !== groupId) : [...current, groupId];
  if (inGroup && target.groupOrder) {
    const { [groupId]: _removed, ...rest } = target.groupOrder;
    target.groupOrder = Object.keys(rest).length ? rest : undefined;
  }
  target.updatedAt = new Date().toISOString();
  if (target.isMaster) target.metaUpdatedAt = target.updatedAt;
  writeAllSongs(songs);
  triggerCloudSync();
  return !inGroup;
}

// Manual order of the songs inside a group: ids in the order they should appear
export function setGroupOrder(groupId: string, orderedIds: string[]): void {
  const songs = readAllSongs();
  const now = new Date().toISOString();
  let changed = false;
  orderedIds.forEach((id, pos) => {
    const target = songs.find(s => s.id === id && !s.deletedAt);
    if (!target || target.groupOrder?.[groupId] === pos) return;
    target.groupOrder = { ...target.groupOrder, [groupId]: pos };
    target.updatedAt = now;
    if (target.isMaster) target.metaUpdatedAt = now;
    changed = true;
  });
  if (!changed) return;
  writeAllSongs(songs);
  triggerCloudSync();
}

// Cloud synchronization logic
let syncInProgress = false;
let syncQueued = false;
let syncStatusState: CloudSyncStatus = {
  lastSyncAt: typeof window !== 'undefined' ? localStorage.getItem(LAST_SYNC_KEY) : null,
  isSyncing: false,
  pendingChanges: 0,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  error: null,
};

const syncStatusListeners = new Set<(status: CloudSyncStatus) => void>();

export function subscribeToSyncStatus(listener: (status: CloudSyncStatus) => void) {
  syncStatusListeners.add(listener);
  listener(syncStatusState);
  return () => {
    syncStatusListeners.delete(listener);
  };
}

function updateSyncStatus(patch: Partial<CloudSyncStatus>) {
  syncStatusState = { ...syncStatusState, ...patch };
  syncStatusListeners.forEach(fn => fn(syncStatusState));
}

// Listen to network changes
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    updateSyncStatus({ online: true, error: null });
    triggerCloudSync();
  });
  window.addEventListener('offline', () => {
    updateSyncStatus({ online: false });
  });
}

/**
 * Triggers automatic cloud sync with backend server
 */
export async function triggerCloudSync(): Promise<{ success: boolean; count?: number }> {
  if (syncInProgress) {
    syncQueued = true; // re-run once the current sync ends so recent changes aren't missed
    return { success: false };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    updateSyncStatus({ online: false });
    return { success: false };
  }
  if (!storageUserId) return { success: false }; // nobody signed in: nothing to sync

  syncInProgress = true;
  const syncUserId = storageUserId;
  updateSyncStatus({ isSyncing: true, error: null });

  try {
    const localSongs = readAllSongs();

    // Push local songs to cloud
    const response = await apiFetch('/api/sync/push', {
      method: 'POST',
      // The server refuses the upload if the session belongs to another account than the one these songs came from
      headers: { 'Content-Type': 'application/json', 'X-Lirika-User': syncUserId },
      body: JSON.stringify({ songs: localSongs }),
    });

    if (!response.ok) {
      throw new Error(`Sync error: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && Array.isArray(data.songs)) {
      // Merge cloud changes back into local storage
      // Merge into the *current* store, not the snapshot that was pushed: edits made while the
      // request was in flight (e.g. toggling a heart) would otherwise be overwritten and flip back.
      if (storageUserId !== syncUserId) throw new Error('La cuenta cambió durante la sincronización');
      const mergedMap = new Map<string, Song>();
      readAllSongs().forEach(s => mergedMap.set(s.id, s));
      data.songs.forEach((s: Song) => {
        const existing = mergedMap.get(s.id);
        if (!existing) {
          mergedMap.set(s.id, s);
        } else if (s.isMaster) {
          // A master: its content always comes from the cloud. A tombstone here is a deleted copy (the master is
          // visible again); a live personal song is a copy made in the meantime (keep it).
          if (existing.deletedAt || existing.isMaster) {
            const keepOwnMeta =
              existing.isMaster && !existing.deletedAt && new Date(existing.metaUpdatedAt || 0) > new Date(s.metaUpdatedAt || 0);
            mergedMap.set(
              s.id,
              keepOwnMeta
                ? { ...s, isFavorite: existing.isFavorite, groupIds: existing.groupIds, groupOrder: existing.groupOrder, metaUpdatedAt: existing.metaUpdatedAt }
                : s
            );
          }
        } else if (existing.isMaster) {
          // The cloud says this account already has its own copy
          mergedMap.set(s.id, s);
        } else {
          const localTime = new Date(existing.updatedAt || 0).getTime();
          const remoteTime = new Date(s.updatedAt || 0).getTime();
          if (remoteTime > localTime) {
            mergedMap.set(s.id, s);
          }
        }
      });

      // Masters this account pushed but the cloud no longer sends (e.g. the admin changed the starter set) leave the library,
      // unless they were touched while the request was in flight
      const returnedIds = new Set<string>(data.songs.map((s: Song) => s.id));
      localSongs.forEach(m => {
        if (!m.isMaster || m.deletedAt || returnedIds.has(m.id)) return;
        const cur = mergedMap.get(m.id);
        if (cur && cur.isMaster && !cur.deletedAt && cur.updatedAt === m.updatedAt) mergedMap.delete(m.id);
      });

      const finalSongs = Array.from(mergedMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(finalSongs));
      localStorage.setItem(LAST_SYNC_KEY, data.lastSyncAt || new Date().toISOString());

      updateSyncStatus({
        isSyncing: false,
        lastSyncAt: data.lastSyncAt || new Date().toISOString(),
        pendingChanges: 0,
        error: null,
      });

      notify();
      syncInProgress = false;
      if (syncQueued) {
        syncQueued = false;
        triggerCloudSync();
      }
      return { success: true, count: finalSongs.filter(s => !s.deletedAt).length };
    }
    throw new Error('Respuesta inválida del servidor');
  } catch (err: any) {
    updateSyncStatus({
      isSyncing: false,
      error: 'Sin conexión al servidor en la nube. Operando en modo local.',
    });
    syncInProgress = false;
    syncQueued = false;
    return { success: false };
  }
}

// User styling & display preferences
export interface GlobalDisplayPreferences {
  themeMode: 'dark' | 'light' | 'stage';
  displayMode: 'standard' | 'live';
  fontSize: number; // 14 to 40
  fontFamily: 'sans' | 'serif' | 'mono' | 'condensed';
  lineHeight: 'compact' | 'normal' | 'relaxed';
  align: 'left' | 'center' | 'right';
  isBold: boolean;
  isItalic: boolean;
  textTransform: 'none' | 'uppercase' | 'capitalize';
  highlightChorus: boolean;
  scrollSpeed: number; // 10 to 120 px/sec
  pagingMode: boolean; // false = continuous scroll, true = screen-by-screen page flips
  keepScreenAwake: boolean;
}

export const DEFAULT_PREFERENCES: GlobalDisplayPreferences = {
  themeMode: 'dark', // Default to Dark mode for comfortable reading
  displayMode: 'standard', // 'standard' or 'live'
  fontSize: 19,
  fontFamily: 'sans',
  lineHeight: 'normal',
  align: 'left',
  isBold: false,
  isItalic: false,
  textTransform: 'none',
  highlightChorus: true,
  scrollSpeed: 28,
  pagingMode: false,
  keepScreenAwake: true,
};

export function getPreferences(): GlobalDisplayPreferences {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Partial<GlobalDisplayPreferences>): GlobalDisplayPreferences {
  const current = getPreferences();
  const updated = { ...current, ...prefs };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}
