import React, { useState } from 'react';
import { Search, X, Loader2, ExternalLink, ChevronLeft, AlertCircle, Sparkles, Download } from 'lucide-react';
import { Song } from '../types/song';
import { cleanLrcContent } from '../utils/lyricsParser';
import { upsertSong } from '../utils/storage';
import { apiFetch } from '../utils/auth';

interface LyricsSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSongCreated: (song: Song) => void;
}

type EngineKey = 'lrclib' | 'letras';
type SourceKey = 'general' | EngineKey;

interface SourceDef {
  key: SourceKey;
  label: string;
  hint: string;
}

const SOURCES: SourceDef[] = [
  {
    key: 'general',
    label: 'Base de datos',
    hint: 'Busca primero en la base de datos general. Si la canción no está, la busca sola en LRCLIB y Letras.com.',
  },
  {
    key: 'lrclib',
    label: 'LRCLIB',
    hint: 'Búsqueda abierta con letras completas.',
  },
  {
    key: 'letras',
    label: 'Letras.com',
    hint: 'Busca aquí y extrae la letra. Si el sitio bloquea la descarga, ábrelo y pega el texto.',
  },
];

interface WebResult {
  id: string;
  title: string;
  artist: string;
  album?: string;
  source: SourceKey;
  song?: Song; // full song when the result comes from the general database
  plainLyrics?: string;
  syncedLyrics?: string;
  pageUrl?: string;
  needsFetch?: boolean;
}

const FIELD =
  'w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400';

export function LyricsSearchModal({ isOpen, onClose, onSongCreated }: LyricsSearchModalProps) {
  const [source, setSource] = useState<SourceKey>('general');
  const [resultsFrom, setResultsFrom] = useState<SourceKey | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  // Editor step
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');

  if (!isOpen) return null;

  const src = SOURCES.find((s) => s.key === source)!;

  const reset = () => {
    setResults([]);
    setResultsFrom(null);
    setFallbackNote(null);
    setSearched(false);
    setError(null);
    setBlockedUrl(null);
  };

  const handleClose = () => {
    setEditing(false);
    setTitle('');
    setArtist('');
    setLyrics('');
    setQuery('');
    reset();
    onClose();
  };

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    reset();
    setLoading(true);

    const searchEngine = async (engine: EngineKey): Promise<WebResult[]> => {
      const res = await apiFetch(`/api/lyrics/web-search?source=${engine}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de búsqueda');
      return data.results || [];
    };

    try {
      if (source === 'general') {
        // 1) General database; 2) only if it has nothing, the search engines in order
        const res = await apiFetch(`/api/songs/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error de búsqueda');
        if (data.results?.length) {
          setResults(data.results);
          setResultsFrom('general');
        } else {
          setFallbackNote('No está en la base de datos general; se buscó en los motores de búsqueda.');
          let lastError: string | null = null;
          for (const engine of ['lrclib', 'letras'] as EngineKey[]) {
            try {
              const found = await searchEngine(engine);
              if (found.length) {
                setResults(found);
                setResultsFrom(engine);
                lastError = null;
                break;
              }
            } catch (err: any) {
              lastError = err?.message || 'Error de búsqueda';
            }
          }
          if (lastError) setError(lastError);
        }
      } else {
        setResults(await searchEngine(source));
        setResultsFrom(source);
      }
      setSearched(true);
    } catch (err: any) {
      setError(err?.message || 'No se pudo buscar. Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (t: string, a: string, l: string) => {
    setTitle(t);
    setArtist(a);
    setLyrics(l);
    setEditing(true);
    setError(null);
  };

  const pickResult = async (item: WebResult) => {
    setError(null);
    setBlockedUrl(null);
    if (item.source === 'general' && item.song) {
      // Already in the shared database: add it to this device's library if needed and open it
      onSongCreated(upsertSong({ ...item.song, source: item.song.source ?? 'cloud' }));
      handleClose();
      return;
    }
    if (!item.needsFetch) {
      const raw = item.plainLyrics || item.syncedLyrics || '';
      if (!raw.trim()) {
        setError('Esta entrada no trae letra. Prueba con otro resultado.');
        return;
      }
      openEditor(item.title, item.artist, cleanLrcContent(raw));
      return;
    }
    setFetchingId(item.id);
    try {
      const res = await apiFetch(`/api/lyrics/web-fetch?url=${encodeURIComponent(item.pageUrl || '')}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo extraer la letra.');
        setBlockedUrl(data.pageUrl || item.pageUrl || null);
        // Still let the user paste manually with title/artist prefilled
        return;
      }
      openEditor(item.title, item.artist, data.lyrics);
    } catch {
      setError('No se pudo extraer la letra.');
      setBlockedUrl(item.pageUrl || null);
    } finally {
      setFetchingId(null);
    }
  };

  const handleAutoFormat = () => {
    if (!lyrics.trim()) return;
    const text = cleanLrcContent(lyrics).replace(
      /^(verso\s*\d*|verse\s*\d*|coro|chorus|estribillo|intro|puente|bridge|outro|solo):\s*$/gim,
      (m) => {
        const c = m.replace(':', '').trim();
        return `[${c.charAt(0).toUpperCase() + c.slice(1)}]`;
      }
    );
    setLyrics(text);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Ingresa el título de la canción.');
    if (!lyrics.trim()) return setError('La letra está vacía.');
    const now = new Date().toISOString();
    const saved = upsertSong({
      id: `web_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      artist: artist.trim() || 'Artista Desconocido',
      lyrics: lyrics.trim(),
      source: 'online',
      createdAt: now,
      updatedAt: now,
      isFavorite: false,
    });
    onSongCreated(saved);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-lg bg-white/[0.06] backdrop-blur-xl border border-white/10 text-[color:var(--ink)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            {editing ? (
              <button
                onClick={() => setEditing(false)}
                className="p-1 -ml-1 rounded-full hover:bg-white/10"
                title="Volver a resultados"
              >
                <ChevronLeft className="w-5 h-5 text-amber-400" />
              </button>
            ) : (
              <Search className="w-5 h-5 text-amber-400" />
            )}
            <h2 className="text-base font-semibold">{editing ? 'Editar y guardar letra' : 'Buscar letra en la web'}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-zinc-400 hover:text-[color:var(--ink)] rounded-2xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-5 py-2.5 bg-red-950/60 border-b border-red-900/60 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span>{error}</span>
              {blockedUrl && (
                <a
                  href={blockedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-semibold text-amber-300 hover:underline"
                >
                  Abrir en el sitio y copiar la letra <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {editing ? (
          <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-3 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Título *</label>
                <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Artista</label>
                <input className={FIELD} value={artist} onChange={(e) => setArtist(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-zinc-400">Letra *</label>
                <button
                  type="button"
                  onClick={handleAutoFormat}
                  className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Auto-formatear secciones
                </button>
              </div>
              <textarea
                rows={12}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                className={`${FIELD} leading-relaxed resize-none`}
              />
            </div>
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 rounded-2xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold bg-[oklch(0.82_0.14_75)] hover:bg-[oklch(0.86_0.13_75)] text-zinc-950 rounded-2xl transition-colors"
              >
                Guardar en mi biblioteca
              </button>
            </div>
          </form>
        ) : (
          <div className="p-5 overflow-y-auto space-y-3 text-sm">
            {/* Source selector */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setSource(s.key);
                    reset();
                  }}
                  className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                    source === s.key
                      ? 'bg-[oklch(0.82_0.14_75)] text-[#17130a] border-[oklch(0.82_0.14_75)]'
                      : 'bg-white/[0.07] border-white/[0.12]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400">{src.hint}</p>

            <form onSubmit={runSearch} className="flex gap-2">
              <input
                autoFocus
                className={FIELD}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Canción y artista, ej. Lamento Boliviano"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="shrink-0 px-4 rounded-2xl bg-[oklch(0.82_0.14_75)] text-[#17130a] text-xs font-extrabold disabled:opacity-50 flex items-center gap-1.5"
              >
                <Search className="w-4 h-4" />
                Buscar
              </button>
            </form>

            {loading && (
              <div className="flex flex-col items-center py-8 gap-2 opacity-70">
                <Loader2 className="w-6 h-6 animate-spin text-[oklch(0.82_0.14_75)]" />
                <span className="text-xs">Buscando en {source === 'general' ? 'la base de datos general' : src.label}…</span>
              </div>
            )}

            {!loading && fallbackNote && (
              <p className="text-[11px] text-amber-300/90">
                {results.length ? fallbackNote : 'No está en la base de datos general ni en los motores de búsqueda.'}
              </p>
            )}

            {!loading && searched && results.length === 0 && (
              <p className="text-center text-xs opacity-60 py-6">
                Sin resultados. Prueba con menos palabras o solo el título.
              </p>
            )}

            {!loading && resultsFrom && results.length > 0 && (
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Resultados de {SOURCES.find((s) => s.key === resultsFrom)?.label}
              </p>
            )}

            {!loading &&
              results.map((item) => (
                <div key={item.id} className="px-4 py-3 rounded-2xl flex items-center gap-3 bg-white/[0.06] border border-white/10">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-[14px] truncate">{item.title}</h4>
                    <p className="text-xs opacity-60 truncate mt-0.5">
                      {item.artist}
                      {item.album ? ` · ${item.album}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => pickResult(item)}
                    disabled={fetchingId === item.id}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold shrink-0 bg-[oklch(0.82_0.14_75)] text-[#17130a] disabled:opacity-60"
                  >
                    {fetchingId === item.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    {item.source === 'general' ? 'Abrir' : 'Extraer'}
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
