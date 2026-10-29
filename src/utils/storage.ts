import { Song, CloudSyncStatus } from '../types/song';
import { INITIAL_SONGS } from '../data/defaultSongs';
import { stripChords } from './lyricsParser';

const STORAGE_KEY = 'lirika_songs_v1';
const SETTINGS_KEY = 'lirika_user_settings_v1';
const LAST_SYNC_KEY = 'lirika_last_sync_timestamp';

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First boot: initialize with default songs
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SONGS));
      return [...INITIAL_SONGS];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...INITIAL_SONGS];
  } catch (err) {
    console.error('Error reading songs from localStorage:', err);
    return [...INITIAL_SONGS];
  }
}

function writeAllSongs(songs: Song[]): void {
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
    delete result.deletedAt;
    updatedList = [...songs];
    updatedList[existingIdx] = result;
  } else {
    result = { ...song, createdAt: song.createdAt || now, updatedAt: now };
    updatedList = [result, ...songs];
  }

  writeAllSongs(updatedList);
  triggerCloudSync();
  return result;
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

// Replace the catalog with the initial songs, deleting everything else (syncs to the cloud)
export function resetToInitialSongs(): void {
  const now = new Date().toISOString();
  const initialIds = new Set(INITIAL_SONGS.map(s => s.id));
  const removed = readAllSongs()
    .filter(s => !initialIds.has(s.id))
    .map(s => ({ ...s, deletedAt: s.deletedAt || now, updatedAt: now }));
  const restored = INITIAL_SONGS.map(s => ({ ...s, updatedAt: now, deletedAt: undefined }));
  writeAllSongs([...restored, ...removed]);
  triggerCloudSync();
}

// Toggle Favorite
export function toggleFavoriteSong(id: string): boolean {
  const songs = readAllSongs();
  const target = songs.find(s => s.id === id && !s.deletedAt);
  if (!target) return false;
  target.isFavorite = !target.isFavorite;
  target.updatedAt = new Date().toISOString();
  writeAllSongs(songs);
  triggerCloudSync();
  return !!target.isFavorite;
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

  syncInProgress = true;
  updateSyncStatus({ isSyncing: true, error: null });

  try {
    const localSongs = readAllSongs();

    // Push local songs to cloud
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs: localSongs }),
    });

    if (!response.ok) {
      throw new Error(`Sync error: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && Array.isArray(data.songs)) {
      // Merge cloud changes back into local storage
      const mergedMap = new Map<string, Song>();
      localSongs.forEach(s => mergedMap.set(s.id, s));
      data.songs.forEach((s: Song) => {
        const existing = mergedMap.get(s.id);
        if (!existing) {
          mergedMap.set(s.id, s);
        } else {
          const localTime = new Date(existing.updatedAt || 0).getTime();
          const remoteTime = new Date(s.updatedAt || 0).getTime();
          if (remoteTime > localTime) {
            mergedMap.set(s.id, s);
          }
        }
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
