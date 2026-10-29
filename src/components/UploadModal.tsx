import React, { useState, useRef } from 'react';
import { Upload, FileText, Check, X, Sparkles, AlertCircle } from 'lucide-react';
import { Song } from '../types/song';
import { cleanLrcContent } from '../utils/lyricsParser';
import { upsertSong } from '../utils/storage';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSongCreated: (song: Song) => void;
}

export function UploadModal({ isOpen, onClose, onSongCreated }: UploadModalProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'file'>('paste');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [tempo, setTempo] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Smart lyrics cleaner and section auto-formatter
  const handleAutoFormat = () => {
    if (!lyrics.trim()) return;

    let text = cleanLrcContent(lyrics);

    // If text has lines like "CORO:" or "Verso 1:" replace with brackets
    text = text.replace(/^(verso\s*\d*|verse\s*\d*|coro|chorus|estribillo|intro|puente|bridge|outro|solo):\s*$/gim, (match) => {
      const clean = match.replace(':', '').trim();
      return `[${clean.charAt(0).toUpperCase() + clean.slice(1)}]`;
    });

    setLyrics(text);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const isLrc = fileName.toLowerCase().endsWith('.lrc');
    const isJson = fileName.toLowerCase().endsWith('.json');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;

        if (isJson) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            parsed.forEach((s) => {
              if (s.title && s.lyrics) {
                upsertSong({
                  ...s,
                  id: s.id || `uploaded_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                  source: 'upload',
                });
              }
            });
            setSuccessMsg(`¡${parsed.length} canciones importadas con éxito!`);
            setTimeout(() => {
              onClose();
            }, 1200);
            return;
          } else if (parsed.title && parsed.lyrics) {
            const newSong = upsertSong({
              ...parsed,
              id: parsed.id || `uploaded_${Date.now()}`,
              source: 'upload',
            });
            onSongCreated(newSong);
            onClose();
            return;
          }
        }

        // It's a text or LRC file
        let cleanText = isLrc ? cleanLrcContent(content) : content;

        // Try to guess title & artist from filename: "Artist - Title.txt"
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
        let guessedArtist = '';
        let guessedTitle = nameWithoutExt;

        if (nameWithoutExt.includes(' - ')) {
          const parts = nameWithoutExt.split(' - ');
          guessedArtist = parts[0].trim();
          guessedTitle = parts[1].trim();
        }

        setTitle(guessedTitle);
        setArtist(guessedArtist);
        setLyrics(cleanText);
        setActiveTab('paste');
        setSuccessMsg('Archivo leído. Puedes revisar los detalles antes de guardar.');
      } catch (err: any) {
        setError('Error al procesar el archivo. Asegúrate de que sea texto legible (.txt, .lrc, o .json).');
      }
    };

    reader.readAsText(file);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Por favor ingresa el título de la canción.');
      return;
    }
    if (!lyrics.trim()) {
      setError('Por favor ingresa o pega la letra.');
      return;
    }

    const newSong: Song = {
      id: `song_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      artist: artist.trim() || 'Artista Desconocido',
      lyrics: cleanLrcContent(lyrics.trim()),
      tempo: tempo ? Number(tempo) : undefined,
      source: 'upload',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: false,
    };

    const saved = upsertSong(newSong);
    onSongCreated(saved);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-lg bg-white/[0.06] backdrop-blur-xl border border-white/10 text-[color:var(--ink)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold">Subir o Pegar Letra</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-[color:var(--ink)] rounded-2xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="grid grid-cols-2 p-1.5 bg-black/25 border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`py-2 text-xs font-medium rounded-2xl transition-colors ${
              activeTab === 'paste'
                ? 'bg-white/15 text-[color:var(--ink)] shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Escribir o Pegar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`py-2 text-xs font-medium rounded-2xl transition-colors ${
              activeTab === 'file'
                ? 'bg-white/15 text-[color:var(--ink)] shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Subir Archivo (.txt, .lrc)
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-red-950/60 border-b border-red-900/60 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-emerald-950/60 border-b border-emerald-900/60 text-xs text-emerald-300">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {activeTab === 'file' ? (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/15 hover:border-amber-400/80 rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-black/20"
              >
                <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-3 text-amber-400">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="font-medium text-zinc-200">Toca para seleccionar un archivo</p>
                <p className="text-xs text-zinc-400 mt-1">Soporta .txt, .lrc con marcas de tiempo, o .json de respaldo</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt,.lrc,.json"
                  className="hidden"
                />
              </div>

              <div className="text-xs text-zinc-400 bg-white/15/40 p-3 rounded-2xl space-y-1">
                <p className="font-semibold text-zinc-300">Consejo de formato:</p>
                <p>Si el nombre del archivo es &ldquo;Artista - Canción.txt&rdquo;, se auto-detectará el autor.</p>
                <p>Las marcas de tiempo de archivos LRC serán limpiadas automáticamente para una lectura fluida.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Título de la canción *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej. De Música Ligera"
                    className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Artista o Banda</label>
                  <input
                    type="text"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Ej. Soda Stereo"
                    className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Tempo BPM de lectura (Opcional)</label>
                  <input
                    type="number"
                    value={tempo}
                    onChange={(e) => setTempo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Ej. 120"
                    className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-zinc-400">Letra de la canción *</label>
                  <button
                    type="button"
                    onClick={handleAutoFormat}
                    className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Auto-formatear secciones
                  </button>
                </div>
                <textarea
                  required
                  rows={8}
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={`[Verso 1]\nElla durmió al calor de las brasas\nY yo desperté queriendo soñarla...\n\n[Coro]\nDe aquel amor de música ligera\nNada nos libra, nada más queda...`}
                  className="w-full px-3 py-2.5 bg-black/25 border border-white/10 rounded-2xl text-sm font-sans text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 resize-none leading-relaxed"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Cada sección se separa con un salto arriba y abajo. Puedes incluir etiquetas como [Coro], [Verso 1], [Puente].
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 rounded-2xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-medium bg-[oklch(0.82_0.14_75)] hover:bg-[oklch(0.86_0.13_75)] text-zinc-950 rounded-2xl transition-colors font-semibold shadow-sm"
                >
                  Guardar en Modo Offline
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
