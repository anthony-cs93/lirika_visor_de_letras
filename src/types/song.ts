export type ThemeMode = 'dark' | 'light' | 'stage';
export type LyricsDisplayMode = 'standard' | 'live';
export type FontFamily = 'sans' | 'serif' | 'mono' | 'condensed';
export type LineHeight = 'compact' | 'normal' | 'relaxed';
export type TextAlign = 'left' | 'center' | 'right';
export type TextTransform = 'none' | 'uppercase' | 'capitalize';

export type SectionType =
  | 'intro'
  | 'interlude'
  | 'verse'
  | 'prechorus'
  | 'chorus'
  | 'bridge'
  | 'solo'
  | 'outro'
  | 'custom';

export interface SongStyleSettings {
  fontSize: number; // in px (14 - 40)
  fontFamily: FontFamily;
  lineHeight: LineHeight;
  align: TextAlign;
  isBold: boolean;
  isItalic: boolean;
  textTransform: TextTransform;
  scrollSpeed: number; // in px per second, e.g. 28
  highlightChorus: boolean; // Subtle visual emphasis for choruses
  displayMode: LyricsDisplayMode; // 'standard' | 'live'
}

export interface SongBlock {
  id: string;
  sectionType: SectionType;
  sectionLabel: string; // e.g. "Verso 1", "Coro", "Puente"
  lines: string[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  lyrics: string; // Stored as clean lyrics with blocks separated by empty lines and section tags
  tempo?: number; // BPM for reading pace (legacy, no longer edited)
  key?: string; // Tonalidad, e.g. "Am", "G", "F#m"
  timeSignature?: string;
  tags?: string[];
  isFavorite?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string; // set when deleted; kept as a tombstone so the deletion syncs
  source?: 'local' | 'cloud' | 'upload' | 'online';
  customStyle?: Partial<SongStyleSettings>;
}

export interface SectionMark {
  index: number;
  label: string;
  blockIndex: number;
  type: SectionType;
}

export interface CloudSyncStatus {
  lastSyncAt: string | null;
  isSyncing: boolean;
  pendingChanges: number;
  online: boolean;
  error: string | null;
}
