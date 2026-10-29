import React, { useState, useEffect, useRef } from 'react';
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
  Sliders,
  ChevronRight,
  Sparkles,
  Download,
  Check,
  Loader2,
  FileText,
  Sun,
  Moon,
} from 'lucide-react';
import { Song, CloudSyncStatus } from '../types/song';
import { parseLyricsToBlocks } from '../utils/lyricsParser';
import { ConfirmDialog } from './ConfirmDialog';
import { usePinGuard } from './PinGuard';
import { FavBurst } from './FavBurst';
import { randomFavMessage } from '../utils/favMessages';
import {
  getLocalSongs,
  toggleFavoriteSong,
  deleteSong,
  upsertSong,
  subscribeToStore,
  subscribeToSyncStatus,
  triggerCloudSync,
} from '../utils/storage';

interface SongListProps {
  onSelectSong: (song: Song) => void;
  onNewSong: () => void;
  onOpenUpload: () => void;
  onOpenSettings: () => void;
  isLight: boolean;
  onToggleTheme: () => void;
}

export function SongList({
  onSelectSong,
  onNewSong,
  onOpenUpload,
  onOpenSettings,
  isLight,
  onToggleTheme,
}: SongListProps) {
  const [songs, setSongs] = useState<Song[]>(getLocalSongs());
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Song | null>(null);
  const { guard, pinDialog } = usePinGuard();
  // Message floating above the heart that was just pressed (n makes each press a fresh animation)
  const [burst, setBurst] = useState<{ id: string; text: string; n: number } | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [filterTab, setFilterTab] = useState<'all' | 'favorites' | 'uploaded' | 'chorus'>('all');

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
      const res = await fetch(`/api/lyrics/search?q=${encodeURIComponent(queryText.trim())}`);
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
    if (filterTab === 'uploaded') return song.source === 'upload';
    if (filterTab === 'chorus') return /\[?(coro|chorus|estribillo)\]?/i.test(song.lyrics);

    return true;
  });

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

  const tabs: { key: 'all' | 'favorites' | 'uploaded' | 'chorus' | 'online'; label: string }[] = [
    { key: 'all', label: 'Mis letras' },
    { key: 'favorites', label: 'Favoritas' },
  ];
  const activeTab = isSearchingOnline ? 'online' : filterTab;
  const selectTab = (key: (typeof tabs)[number]['key']) => {
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
            <h1 className="text-3xl font-extrabold tracking-tight leading-none">Lirika</h1>
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
          <button
            onClick={onOpenSettings}
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${GLASS}`}
            title="Ajustes y sincronización"
          >
            <Sliders className="w-[18px] h-[18px]" />
          </button>
          </div>
        </header>

        {/* Search */}
        <div className="px-5 mt-4 shrink-0">
          <div className={`relative h-12 rounded-full flex items-center gap-2.5 px-4 ${GLASS}`}>
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
                {t.key === 'all' ? ` (${songs.length})` : ''}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-32 space-y-2 [mask-image:linear-gradient(transparent,#000_22px)]">
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
            filteredSongs.map((song) => {
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
                  onClick={() => onSelectSong(song)}
                  className={`group py-2 pl-2.5 pr-1.5 rounded-[22px] flex items-center gap-3 cursor-pointer transition-all hover:bg-white/10 active:scale-[0.99] ${GLASS}`}
                >
                  <div
                    className="w-11 h-11 rounded-[14px] shrink-0 flex items-center justify-center text-lg font-extrabold text-[#0a0a0e]/75"
                    style={{ background: artGradient(song.title) }}
                  >
                    {song.title.trim()[0]?.toUpperCase() || '♪'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[15px] leading-tight tracking-tight truncate">{song.title}</h3>
                    <p className="text-xs opacity-60 truncate mt-px">{song.artist}</p>
                    {meta && <p className="text-[11px] opacity-50 mt-0.5 truncate">{meta}</p>}
                  </div>
                  <div className="flex items-center shrink-0">
                    <span
                      className="mr-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums bg-white/[0.06] border border-white/[0.08] text-[color:var(--ink)]/55"
                      title={`${sectionCount} ${sectionCount === 1 ? 'sección' : 'secciones'}`}
                    >
                      {sectionCount} secc.
                    </span>
                    <button
                      onClick={(e) => handleToggleFav(e, song.id)}
                      className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        song.isFavorite ? 'text-[oklch(0.75_0.17_10)]' : 'text-[color:var(--ink)]/40 hover:text-[color:var(--ink)]'
                      }`}
                      title="Marcar como favorita"
                    >
                      <Heart className={`w-[18px] h-[18px] ${song.isFavorite ? 'fill-current' : ''}`} />
                      {burst?.id === song.id && <FavBurst key={burst.n} text={burst.text} />}
                    </button>
                    <button
                      onClick={(e) => handleDeleteSong(e, song.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[color:var(--ink)]/30 hover:text-[oklch(0.75_0.17_10)] transition-colors"
                      title="Eliminar canción"
                    >
                      <Trash2 className="w-[15px] h-[15px]" />
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
