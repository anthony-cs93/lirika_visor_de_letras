import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  Search,
  Plus,
  Globe,
  Music,
  Heart,
  Trash2,
  Cloud,
  Wifi,
  WifiOff,
  UserRound,
  ChevronRight,
  Sparkles,
  Download,
  Check,
  Loader2,
  FileText,
  Sun,
  Moon,
  ShieldCheck,
  FolderPlus,
  Folder,
  ArrowUp,
  ArrowDown,
  Pencil,
  GripVertical,
} from 'lucide-react';
import { Song, CloudSyncStatus } from '../types/song';
import { parseLyricsToBlocks } from '../utils/lyricsParser';
import { ConfirmDialog } from './ConfirmDialog';
import { usePinGuard } from './PinGuard';
import { useAuth } from './AuthGate';
import { FavBurst } from './FavBurst';
import { randomFavMessage } from '../utils/favMessages';
import { SongGroup, MAX_GROUPS, GROUP_NAME_MAX, readCachedGroups, fetchGroups, groupsApi } from '../utils/groups';
import {
  getLocalSongs,
  getStorageUserId,
  toggleFavoriteSong,
  toggleSongGroup,
  setGroupOrder,
  deleteSong,
  upsertSong,
  subscribeToStore,
  subscribeToSyncStatus,
  triggerCloudSync,
} from '../utils/storage';
import { apiFetch } from '../utils/auth';
import { LogoHorizontal } from './Logo';

// Where the user was in the list (tab and scroll): the list unmounts while a song is open,
// so this lets "back" return to the same group instead of the whole library.
let listMemory: { userId: string | null; tab: string; scroll: number } | null = null;
const remembered = () => (listMemory && listMemory.userId === getStorageUserId() ? listMemory : null);

interface SongListProps {
  onSelectSong: (song: Song) => void;
  onNewSong: () => void;
  onOpenUpload: () => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  isLight: boolean;
  onToggleTheme: () => void;
}

export function SongList({
  onSelectSong,
  onNewSong,
  onOpenUpload,
  onOpenSettings,
  onOpenAdmin,
  isLight,
  onToggleTheme,
}: SongListProps) {
  const [songs, setSongs] = useState<Song[]>(getLocalSongs());
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Song | null>(null);
  const { guard, pinDialog } = usePinGuard();
  const { user } = useAuth();
  // Message floating above the heart that was just pressed (n makes each press a fresh animation)
  const [burst, setBurst] = useState<{ id: string; text: string; n: number } | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Sort order for the list: alphabetical (title) or date added; tapping the active option flips its direction
  const [sort, setSort] = useState<{ by: 'alpha' | 'date'; dir: 'asc' | 'desc' }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lirika_sort') || 'null');
      if ((saved?.by === 'alpha' || saved?.by === 'date') && (saved?.dir === 'asc' || saved?.dir === 'desc')) return saved;
    } catch {
      /* storage unavailable */
    }
    return { by: 'date', dir: 'desc' };
  });
  useEffect(() => {
    try {
      localStorage.setItem('lirika_sort', JSON.stringify(sort));
    } catch {
      /* storage unavailable */
    }
  }, [sort]);
  const pickSort = (by: 'alpha' | 'date') =>
    setSort((cur) =>
      cur.by === by
        ? { by, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { by, dir: by === 'alpha' ? 'asc' : 'desc' } // A-Z and newest first by default
    );

  const [filterTab, setFilterTab] = useState<string>(() => remembered()?.tab ?? 'all'); // 'all' | 'favorites' | 'uploaded' | 'chorus' | `group:<id>`

  // Groups (folders): up to MAX_GROUPS, shown after "Favoritas"
  const [groups, setGroups] = useState<SongGroup[]>(readCachedGroups());
  const [groupDialog, setGroupDialog] = useState<{ mode: 'create' } | { mode: 'rename'; group: SongGroup } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SongGroup | null>(null);
  const [pickerSongId, setPickerSongId] = useState<string | null>(null);

  // Online search state
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [onlineResults, setOnlineResults] = useState<any[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  // Cloud sync status
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>({
    lastSyncAt: null,
    isSyncing: false,
    pendingChanges: 0,
    online: true,
    error: null,
  });

  useEffect(() => {
    const unsubStore = subscribeToStore(() => {
      setSongs(getLocalSongs());
    });
    const unsubSync = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });
    // Trigger initial background sync on mount
    triggerCloudSync();
    fetchGroups().then(setGroups).catch(() => {}); // offline: keep the cached groups

    return () => {
      unsubStore();
      unsubSync();
    };
  }, []);

  // Perform online lyrics search via backend proxy
  const handleOnlineSearch = async (queryText: string) => {
    if (!queryText.trim()) {
      setOnlineResults([]);
      return;
    }
    setOnlineLoading(true);
    setOnlineError(null);

    try {
      const res = await apiFetch(`/api/lyrics/search?q=${encodeURIComponent(queryText.trim())}`);
      if (!res.ok) throw new Error('Error al conectar con el buscador');
      const data = await res.json();
      setOnlineResults(data.results || []);
    } catch (err: any) {
      setOnlineError('No se pudo buscar en línea. Verifica tu conexión.');
      setOnlineResults([]);
    } finally {
      setOnlineLoading(false);
    }
  };

  // Import online song to offline library
  const handleImportOnlineSong = (onlineItem: any) => {
    const lyrics = onlineItem.plainLyrics || onlineItem.syncedLyrics || 'Letra no disponible';
    const newSong: Song = {
      id: `imported_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: onlineItem.title || 'Sin título',
      artist: onlineItem.artist || 'Artista Desconocido',
      album: onlineItem.album || undefined,
      lyrics: lyrics,
      source: 'online',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: false,
    };

    upsertSong(newSong);
    setImportedIds((prev) => new Set(prev).add(onlineItem.id));
  };

  // Filter local songs
  const filteredSongs = songs.filter((song) => {
    // Search query matching title, artist, or lyric lines
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      song.title.toLowerCase().includes(q) ||
      song.artist.toLowerCase().includes(q) ||
      song.lyrics.toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (filterTab === 'favorites') return song.isFavorite;
    if (filterTab.startsWith('group:')) return !!song.groupIds?.includes(filterTab.slice(6));
    if (filterTab === 'uploaded') return song.source === 'upload';
    if (filterTab === 'chorus') return /\[?(coro|chorus|estribillo)\]?/i.test(song.lyrics);

    return true;
  });
  const sign = sort.dir === 'asc' ? 1 : -1;
  // Alphabetical order ignores leading punctuation, so "¿Quién es?" is filed under Q
  const sortKey = (title: string) => title.replace(/^[^\p{L}\p{N}]+/u, '');
  const groupTabId = filterTab.startsWith('group:') ? filterTab.slice(6) : null;
  filteredSongs.sort((a, b) =>
    sort.by === 'alpha'
      ? sign * sortKey(a.title).localeCompare(sortKey(b.title), 'es', { sensitivity: 'base' })
      : sign * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  );
  if (groupTabId) {
    // Inside a group the order is the one the user dragged; songs never placed yet go last (alphabetical)
    const pos = (s: Song) => s.groupOrder?.[groupTabId] ?? Number.MAX_SAFE_INTEGER;
    filteredSongs.sort(
      (a, b) =>
        pos(a) - pos(b) ||
        sortKey(a.title).localeCompare(sortKey(b.title), 'es', { sensitivity: 'base' })
    );
  }

  // ---- Drag to reorder (groups only; the grip handle starts it) ----
  const canReorder = !!groupTabId && !searchQuery.trim() && !isSearchingOnline;
  const listRef = useRef<HTMLDivElement>(null);
  // Restore the scroll position on return (once, with the first render of the list)
  useLayoutEffect(() => {
    const m = remembered();
    if (m && listRef.current) listRef.current.scrollTop = m.scroll;
  }, []);
  useEffect(() => {
    listMemory = { userId: getStorageUserId(), tab: filterTab, scroll: listMemory?.tab === filterTab ? listMemory.scroll : 0 };
  }, [filterTab]);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; h: number } | null>(null);
  const dragInfo = useRef<{
    id: string;
    from: number;
    startY: number;
    startScroll: number;
    centers: number[]; // row centers in list (content) coordinates, at drag start
    h: number; // dragged row height + gap
    pointerY: number;
    raf: number;
    order: string[];
  } | null>(null);
  const DRAG_GAP_PX = 8; // space-y-2
  const EDGE_PX = 64;

  const dragUpdate = () => {
    const info = dragInfo.current;
    const list = listRef.current;
    if (!info || !list) return;
    const dy = info.pointerY - info.startY + (list.scrollTop - info.startScroll);
    const center = info.centers[info.from] + dy;
    let to = 0;
    info.centers.forEach((c, i) => {
      if (i !== info.from && c < center) to++;
    });
    setDrag({ id: info.id, from: info.from, to, dy, h: info.h });
  };

  const dragAutoScroll = () => {
    const info = dragInfo.current;
    const list = listRef.current;
    if (!info || !list) return;
    const r = list.getBoundingClientRect();
    let speed = 0;
    if (info.pointerY < r.top + EDGE_PX) speed = -Math.ceil(((r.top + EDGE_PX - info.pointerY) / EDGE_PX) * 12);
    else if (info.pointerY > r.bottom - EDGE_PX) speed = Math.ceil(((info.pointerY - (r.bottom - EDGE_PX)) / EDGE_PX) * 12);
    if (speed) {
      list.scrollTop += speed;
      dragUpdate();
    }
    info.raf = requestAnimationFrame(dragAutoScroll);
  };

  const handleDragStart = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const list = listRef.current;
    if (!list || !canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    const order = filteredSongs.map((s) => s.id);
    const from = order.indexOf(id);
    const listTop = list.getBoundingClientRect().top;
    const centers = order.map((sid) => {
      const r = rowRefs.current.get(sid)?.getBoundingClientRect();
      return r ? r.top - listTop + list.scrollTop + r.height / 2 : 0;
    });
    const dragged = rowRefs.current.get(id)?.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfo.current = {
      id,
      from,
      startY: e.clientY,
      startScroll: list.scrollTop,
      centers,
      h: (dragged?.height ?? 64) + DRAG_GAP_PX,
      pointerY: e.clientY,
      raf: requestAnimationFrame(dragAutoScroll),
      order,
    };
    navigator.vibrate?.(10);
    dragUpdate();
  };

  const handleDragMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragInfo.current) return;
    dragInfo.current.pointerY = e.clientY;
    dragUpdate();
  };

  const handleDragEnd = (commit: boolean) => {
    const info = dragInfo.current;
    dragInfo.current = null;
    if (!info) return;
    cancelAnimationFrame(info.raf);
    const cur = drag;
    setDrag(null);
    if (commit && cur && groupTabId && cur.to !== cur.from) {
      const next = info.order.filter((sid) => sid !== info.id);
      next.splice(cur.to, 0, info.id);
      setGroupOrder(groupTabId, next);
    }
  };

  const handleDeleteSong = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const target = songs.find((x) => x.id === id);
    if (target) guard(() => setPendingDelete(target));
  };

  const handleToggleFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const nowFavorite = toggleFavoriteSong(id);
    clearTimeout(burstTimer.current);
    if (nowFavorite) {
      setBurst((prev) => ({ id, text: randomFavMessage(prev?.text), n: (prev?.n ?? 0) + 1 }));
      burstTimer.current = setTimeout(() => setBurst(null), 1600);
    } else {
      setBurst(null);
    }
  };

  const GLASS = 'bg-white/[0.06] border border-white/10 backdrop-blur-xl';
  const artGradient = (title: string) => {
    let h = 0;
    for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `linear-gradient(135deg, oklch(0.8 0.13 ${h}), oklch(0.58 0.15 ${(h + 50) % 360}))`;
  };

  const tabs: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'Mis letras', count: songs.length },
    { key: 'favorites', label: 'Favoritas', count: songs.filter((s) => s.isFavorite).length },
    ...groups.map((g) => ({
      key: `group:${g.id}`,
      label: g.name,
      count: songs.filter((s) => s.groupIds?.includes(g.id)).length,
    })),
  ];
  const activeGroup = groups.find((g) => `group:${g.id}` === filterTab) ?? null;
  // If the active group disappeared (deleted elsewhere), fall back to the whole library
  useEffect(() => {
    if (filterTab.startsWith('group:') && !activeGroup) setFilterTab('all');
  }, [filterTab, activeGroup]);

  const openGroupDialog = (d: NonNullable<typeof groupDialog>) => {
    setGroupName(d.mode === 'rename' ? d.group.name : '');
    setGroupError(null);
    setGroupDialog(d);
  };
  const closeGroupDialog = () => setGroupDialog(null);
  const submitGroup = async () => {
    if (!groupDialog) return;
    const name = groupName.trim().replace(/\s+/g, ' ');
    if (!name) return setGroupError('Escribe un nombre');
    try {
      if (groupDialog.mode === 'create') {
        const created = await groupsApi.create(name);
        setGroups((prev) => [...prev, created]);
        setFilterTab(`group:${created.id}`);
        setIsSearchingOnline(false);
      } else {
        const renamed = await groupsApi.rename(groupDialog.group.id, name);
        setGroups((prev) => prev.map((g) => (g.id === renamed.id ? renamed : g)));
      }
      closeGroupDialog();
    } catch (err: any) {
      setGroupError(err.message === 'Failed to fetch' ? 'Necesitas conexión para cambiar los grupos' : err.message);
    }
  };
  const confirmDeleteGroup = async () => {
    const target = deleteGroupTarget;
    setDeleteGroupTarget(null);
    if (!target) return;
    try {
      await groupsApi.remove(target.id);
      setGroups((prev) => prev.filter((g) => g.id !== target.id));
    } catch {
      setOnlineError('No se pudo eliminar el grupo. Verifica tu conexión.');
    }
  };
  const pickerSong = songs.find((x) => x.id === pickerSongId) ?? null;
  const activeTab = isSearchingOnline ? 'online' : filterTab;
  const selectTab = (key: string) => {
    if (key === 'online') {
      setIsSearchingOnline(true);
      if (searchQuery.trim().length > 1) handleOnlineSearch(searchQuery);
    } else {
      setIsSearchingOnline(false);
      setOnlineResults([]);
      setFilterTab(key);
    }
  };

  return (
    <div className="relative flex flex-col h-full text-[color:var(--ink)] overflow-hidden bg-[color:var(--page)]">
      {pinDialog}

      <ConfirmDialog
        open={!!groupDialog}
        icon={<Folder className="w-6 h-6" />}
        title={groupDialog?.mode === 'rename' ? 'Renombrar grupo' : 'Nuevo grupo'}
        message={
          <span className="block mt-1">
            <input
              autoFocus
              value={groupName}
              maxLength={GROUP_NAME_MAX}
              onChange={(e) => {
                setGroupName(e.target.value);
                setGroupError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && submitGroup()}
              placeholder="Nombre del grupo"
              className="w-full h-11 px-4 rounded-full bg-white/[0.08] border border-white/15 text-sm text-[color:var(--ink)] outline-none focus:border-[oklch(0.82_0.14_75)]"
            />
            <span role="alert" className={`block mt-2 text-xs font-bold text-[oklch(0.7_0.19_22)] ${groupError ? '' : 'hidden'}`}>
              {groupError}
            </span>
          </span>
        }
        onClose={closeGroupDialog}
        actions={[
          { label: 'Cancelar', onClick: closeGroupDialog },
          { label: groupDialog?.mode === 'rename' ? 'Guardar' : 'Crear', tone: 'primary', onClick: submitGroup },
        ]}
      />

      <ConfirmDialog
        open={!!deleteGroupTarget}
        tone="danger"
        icon={<Trash2 className="w-6 h-6" />}
        title={deleteGroupTarget ? `¿Eliminar el grupo "${deleteGroupTarget.name}"?` : ''}
        message="Las canciones no se borran; solo dejan de estar en este grupo."
        onClose={() => setDeleteGroupTarget(null)}
        actions={[
          { label: 'Cancelar', onClick: () => setDeleteGroupTarget(null) },
          { label: 'Eliminar', tone: 'danger', onClick: confirmDeleteGroup },
        ]}
      />

      <ConfirmDialog
        open={!!pickerSong}
        icon={<FolderPlus className="w-6 h-6" />}
        title={pickerSong ? `Grupos de "${pickerSong.title}"` : ''}
        message={
          groups.length === 0 ? (
            'Aún no tienes grupos. Crea uno con el botón + junto a Favoritas.'
          ) : (
            <span className="flex flex-col gap-2 mt-1">
              {groups.map((g) => {
                const inGroup = !!pickerSong?.groupIds?.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => pickerSong && toggleSongGroup(pickerSong.id, g.id)}
                    className={`w-full h-11 px-4 rounded-full flex items-center justify-between text-sm font-bold border transition-colors ${
                      inGroup
                        ? 'bg-[oklch(0.82_0.14_75)] text-[#17130a] border-[oklch(0.82_0.14_75)]'
                        : 'bg-white/[0.08] text-[color:var(--ink)] border-white/15'
                    }`}
                  >
                    <span className="truncate">{g.name}</span>
                    {inGroup && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </span>
          )
        }
        onClose={() => setPickerSongId(null)}
        actions={[{ label: 'Listo', tone: 'primary', onClick: () => setPickerSongId(null) }]}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        icon={<Trash2 className="w-6 h-6" />}
        title={pendingDelete ? `¿Eliminar "${pendingDelete.title}"?` : ''}
        message="Se quitará de tu biblioteca y la eliminación se sincronizará con la nube."
        onClose={() => setPendingDelete(null)}
        actions={[
          { label: 'Cancelar', onClick: () => setPendingDelete(null) },
          {
            label: 'Eliminar',
            tone: 'danger',
            onClick: () => {
              if (pendingDelete) deleteSong(pendingDelete.id);
              setPendingDelete(null);
            },
          },
        ]}
      />

      {/* Aurora background */}
      <div className="pointer-events-none absolute -left-28 -top-16 w-[340px] h-[340px] rounded-full opacity-40 blur-[80px] bg-[oklch(0.72_0.15_70)]" />
      <div className="pointer-events-none absolute -right-36 top-[300px] w-[360px] h-[360px] rounded-full opacity-40 blur-[90px] bg-[oklch(0.62_0.17_300)]" />
      <div className="pointer-events-none absolute -left-20 -bottom-28 w-[300px] h-[300px] rounded-full opacity-30 blur-[80px] bg-[oklch(0.66_0.13_20)]" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <header className="px-5 pt-5 shrink-0 flex items-center justify-between">
          <div>
            <h1 className="leading-none">
              <LogoHorizontal className="h-[47px] w-auto" />
            </h1>
            <div className="flex items-center gap-1.5 mt-1 text-xs opacity-65">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  syncStatus.online ? 'bg-[oklch(0.8_0.14_160)]' : 'bg-amber-400'
                }`}
              />
              {syncStatus.online ? 'Sincronizado' : 'Modo offline'}
            </div>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={onToggleTheme}
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${GLASS}`}
            title={isLight ? 'Modo oscuro' : 'Modo claro'}
          >
            {isLight ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
          </button>
          {user.role === 'admin' && (
            <button
              onClick={onOpenAdmin}
              className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${GLASS}`}
              title="Panel de administración"
            >
              <ShieldCheck className="w-[18px] h-[18px]" />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${GLASS}`}
            title="Cuenta"
          >
            <UserRound className="w-[18px] h-[18px]" />
          </button>
          </div>
        </header>

        {/* Search */}
        <div className="px-5 mt-4 shrink-0">
          <div className={`relative h-10 rounded-full flex items-center gap-2.5 px-4 ${GLASS}`}>
            <Search className="w-4 h-4 opacity-60 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (isSearchingOnline && e.target.value.length > 2) {
                  handleOnlineSearch(e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isSearchingOnline) {
                  handleOnlineSearch(searchQuery);
                }
              }}
              placeholder={isSearchingOnline ? 'Buscar en internet…' : 'Título, artista o frase'}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-[color:var(--ink)] placeholder:text-[color:var(--ink)]/45"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setOnlineResults([]);
                }}
                className="text-xs opacity-50 hover:opacity-100"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 px-5 pt-3.5 pb-3 overflow-x-auto no-scrollbar shrink-0">
          {tabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => selectTab(t.key)}
                disabled={t.key === 'online'}
                title={t.key === 'online' ? 'Próximamente' : undefined}
                className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-[13px] font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-[oklch(0.82_0.14_75)] text-[#17130a] border-[oklch(0.82_0.14_75)]'
                    : 'bg-white/[0.07] text-[color:var(--ink)] border-white/[0.12]'
                }`}
              >
                {t.key === 'online' && <Globe className="inline w-3.5 h-3.5 -mt-0.5 mr-1" />}
                {t.label}
                {` (${t.count})`}
              </button>
            );
          })}
          {groups.length < MAX_GROUPS && (
            <button
              onClick={() => openGroupDialog({ mode: 'create' })}
              aria-label="Crear grupo"
              title={`Crear grupo (${groups.length}/${MAX_GROUPS})`}
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center border border-dashed border-white/25 bg-white/[0.04] text-[color:var(--ink)] active:scale-90 transition-transform"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {!isSearchingOnline && !groupTabId && (
          <div className="flex items-center gap-2 px-5 pb-2.5 shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-45">Ordenar</span>
            {([
              ['alpha', 'A–Z'],
              ['date', 'Fecha'],
            ] as const).map(([by, label]) => {
              const active = sort.by === by;
              const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
              return (
                <button
                  key={by}
                  onClick={() => pickSort(by)}
                  title={
                    by === 'alpha'
                      ? active && sort.dir === 'desc'
                        ? 'Alfabético: Z–A'
                        : 'Alfabético: A–Z'
                      : active && sort.dir === 'asc'
                        ? 'Fecha: más antiguas primero'
                        : 'Fecha: más recientes primero'
                  }
                  className={`shrink-0 flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-bold border transition-all ${
                    active
                      ? 'bg-[oklch(0.82_0.14_75_/_0.18)] text-[oklch(0.85_0.13_75)] border-[oklch(0.82_0.14_75_/_0.5)]'
                      : 'bg-white/[0.05] border-white/[0.1] text-[color:var(--ink)]/70'
                  }`}
                >
                  {by === 'alpha' && active && sort.dir === 'desc' ? 'Z–A' : label}
                  {active && <Arrow className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        )}

        {activeGroup && !isSearchingOnline && (
          <div className="flex items-center gap-4 px-6 -mt-1 pb-2 text-xs font-bold opacity-70 shrink-0">
            <button onClick={() => openGroupDialog({ mode: 'rename', group: activeGroup })} className="flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Renombrar
            </button>
            <button onClick={() => setDeleteGroupTarget(activeGroup)} className="flex items-center gap-1.5 text-[oklch(0.75_0.17_10)]">
              <Trash2 className="w-3.5 h-3.5" /> Eliminar grupo
            </button>
            {canReorder && filteredSongs.length > 1 && (
              <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold opacity-60">
                <GripVertical className="w-3.5 h-3.5" /> Arrastra para ordenar
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div
          ref={listRef}
          onScroll={(e) => {
            if (listMemory) listMemory.scroll = e.currentTarget.scrollTop;
          }}
          className={`flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-32 space-y-2 [mask-image:linear-gradient(transparent,#000_22px)] ${
            drag ? 'touch-none' : ''
          }`}
        >
          {isSearchingOnline ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs opacity-60 px-1">
                <span>Resultados globales · guarda con un toque</span>
                {searchQuery && (
                  <button
                    onClick={() => handleOnlineSearch(searchQuery)}
                    className="text-[oklch(0.85_0.13_75)] font-medium hover:underline"
                  >
                    Buscar &ldquo;{searchQuery}&rdquo;
                  </button>
                )}
              </div>

              {onlineLoading && (
                <div className="flex flex-col items-center justify-center py-12 opacity-70 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[oklch(0.82_0.14_75)]" />
                  <span className="text-xs">Buscando letras en la red...</span>
                </div>
              )}

              {onlineError && (
                <div className="p-4 bg-red-950/40 border border-red-900/50 rounded-3xl text-xs text-red-300 text-center">
                  {onlineError}
                </div>
              )}

              {!onlineLoading &&
                onlineResults.map((item) => {
                  const isImported = importedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`px-4 py-3.5 rounded-[22px] flex items-center gap-3 ${GLASS}`}
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-[15px] truncate">{item.title}</h4>
                        <p className="text-xs opacity-60 truncate mt-0.5">{item.artist}</p>
                        {item.album && (
                          <p className="text-[11px] opacity-40 truncate mt-0.5">{item.album}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleImportOnlineSong(item)}
                        disabled={isImported}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold shrink-0 transition-all ${
                          isImported
                            ? 'bg-white/10 text-[color:var(--ink)]'
                            : 'bg-[oklch(0.82_0.14_75)] text-[#17130a]'
                        }`}
                      >
                        {isImported ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Guardada</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Guardar</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}

              {!onlineLoading && onlineResults.length === 0 && searchQuery && (
                <div className="text-center py-12 opacity-60 space-y-2">
                  <Globe className="w-8 h-8 mx-auto opacity-50 mb-2" />
                  <p className="font-semibold text-sm">Sin resultados para &ldquo;{searchQuery}&rdquo;</p>
                  <p className="text-xs opacity-70">
                    Prueba solo con el título o usa &ldquo;Buscar&rdquo; para traer la letra de la web.
                  </p>
                </div>
              )}

              {!searchQuery && !onlineLoading && (
                <div className="text-center py-12 opacity-50 text-xs">
                  Escribe el título o artista para encontrar cualquier canción y guardarla offline.
                </div>
              )}
            </div>
          ) : filteredSongs.length > 0 ? (
            filteredSongs.map((song, index) => {
              // While dragging: the grabbed row follows the finger, the rows it passes slide out of the way
              let dragStyle: React.CSSProperties | undefined;
              if (drag) {
                if (song.id === drag.id) {
                  dragStyle = { transform: `translateY(${drag.dy}px) scale(1.02)`, transition: 'none', zIndex: 20, position: 'relative' };
                } else {
                  const shift = drag.from < drag.to && index > drag.from && index <= drag.to ? -drag.h : drag.to < drag.from && index >= drag.to && index < drag.from ? drag.h : 0;
                  dragStyle = { transform: `translateY(${shift}px)`, transition: 'transform 200ms ease' };
                }
              }
              const sectionCount = parseLyricsToBlocks(song.lyrics).length;
              const meta = [
                song.key ? `Tono ${song.key}` : '',
                song.source === 'upload' ? 'Subida' : '',
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={song.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(song.id, el);
                    else rowRefs.current.delete(song.id);
                  }}
                  style={dragStyle}
                  onClick={() => onSelectSong(song)}
                  className={`group py-2 pl-2.5 pr-1 rounded-[22px] flex items-center gap-2.5 cursor-pointer ${
                    drag ? (song.id === drag.id ? 'shadow-[0_14px_36px_rgba(0,0,0,0.45)] ring-1 ring-[oklch(0.82_0.14_75_/_0.6)]' : '') : 'transition-all hover:bg-white/10 active:scale-[0.99]'
                  } ${GLASS}`}
                >
                  {canReorder && (
                    <button
                      type="button"
                      aria-label={`Reordenar ${song.title}`}
                      title="Arrastra para reordenar"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => handleDragStart(e, song.id)}
                      onPointerMove={handleDragMove}
                      onPointerUp={() => handleDragEnd(true)}
                      onPointerCancel={() => handleDragEnd(false)}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-6 h-11 -mr-1 shrink-0 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing text-[color:var(--ink)]/35 hover:text-[color:var(--ink)]/70"
                    >
                      <GripVertical className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  <div
                    className="w-11 h-11 rounded-[14px] shrink-0 flex items-center justify-center text-lg font-extrabold text-[#0a0a0e]/75"
                    style={{ background: artGradient(song.title) }}
                  >
                    {song.title.trim()[0]?.toUpperCase() || '♪'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[15px] leading-tight tracking-tight truncate">{song.title}</h3>
                    <p className="text-xs opacity-60 truncate mt-px">{song.artist}</p>
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span
                        className="shrink-0 px-2 py-px rounded-full text-[10px] font-semibold tabular-nums bg-white/[0.06] border border-white/[0.08] text-[color:var(--ink)]/55"
                        title={`${sectionCount} ${sectionCount === 1 ? 'sección' : 'secciones'}`}
                      >
                        {sectionCount} {sectionCount === 1 ? 'sección' : 'secciones'}
                      </span>
                      {meta && <span className="text-[11px] opacity-50 truncate">{meta}</span>}
                    </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    <button
                      onClick={(e) => handleToggleFav(e, song.id)}
                      className={`relative w-7 h-8 rounded-full flex items-center justify-center transition-colors ${
                        song.isFavorite ? 'text-[oklch(0.75_0.17_10)]' : 'text-[color:var(--ink)]/40 hover:text-[color:var(--ink)]'
                      }`}
                      title="Marcar como favorita"
                    >
                      <Heart className={`w-[17px] h-[17px] ${song.isFavorite ? 'fill-current' : ''}`} />
                      {burst?.id === song.id && <FavBurst key={burst.n} text={burst.text} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPickerSongId(song.id);
                      }}
                      className={`w-7 h-8 rounded-full flex items-center justify-center transition-colors ${
                        song.groupIds?.some((id) => groups.some((g) => g.id === id))
                          ? 'text-[oklch(0.82_0.14_75)]'
                          : 'text-[color:var(--ink)]/30 hover:text-[color:var(--ink)]'
                      }`}
                      title="Agregar a grupos"
                    >
                      <FolderPlus className="w-[14px] h-[14px]" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteSong(e, song.id)}
                      className="w-7 h-8 rounded-full flex items-center justify-center text-[color:var(--ink)]/30 hover:text-[oklch(0.75_0.17_10)] transition-colors"
                      title="Eliminar canción"
                    >
                      <Trash2 className="w-[14px] h-[14px]" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-16 space-y-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto text-[oklch(0.82_0.14_75)] ${GLASS}`}>
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold">Sin resultados</h3>
                <p className="text-xs opacity-55 mt-1 max-w-xs mx-auto">
                  {searchQuery
                    ? `No hay canciones que coincidan con "${searchQuery}".`
                    : activeGroup
                      ? 'Este grupo está vacío. Usa el botón de carpeta en una canción para agregarla.'
                      : 'Tu biblioteca está lista para tus canciones favoritas.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Floating action dock */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 flex gap-1.5 p-1.5 rounded-full bg-[color:var(--dock)] border border-white/[0.16] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
          <button
            onClick={onOpenUpload}
            className="flex items-center gap-1.5 px-5 py-3 rounded-full text-sm font-bold hover:bg-white/10 transition-colors"
            title="Buscar una letra en la web, editarla y guardarla"
          >
            <Globe className="w-4 h-4" /> Buscar
          </button>
          <button
            onClick={onNewSong}
            className="flex items-center gap-1.5 px-6 py-3 rounded-full text-sm font-extrabold bg-[oklch(0.82_0.14_75)] text-[#17130a]"
            title="Crear nueva letra"
          >
            <Plus className="w-4 h-4" /> Nueva
          </button>
        </div>
      </div>
    </div>
  );
}
