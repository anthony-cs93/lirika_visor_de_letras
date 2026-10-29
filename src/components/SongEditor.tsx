import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Save,
  Eye,
  Edit3,
  Sliders,
  Type,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Check,
  Info,
  Split,
  Layers,
} from 'lucide-react';
import {
  Song,
  SongBlock,
  SectionType,
  FontFamily,
  LineHeight,
  TextAlign,
  TextTransform,
} from '../types/song';
import {
  parseLyricsToBlocks,
  blocksToLyrics,
  SECTION_DEFINITIONS,
  stripChords,
  SECTION_VARIANTS,
  compactSectionLabel,
} from '../utils/lyricsParser';
import { upsertSong } from '../utils/storage';
import { ConfirmDialog } from './ConfirmDialog';
import {
  getFontFamilyClass,
  getLineHeightClass,
  getTextAlignClass,
  getTextTransformClass,
} from '../utils/theme';

interface SongEditorProps {
  song?: Song | null;
  onBack: () => void;
  onSaved: (song: Song) => void;
}

export function SongEditor({ song, onBack, onSaved }: SongEditorProps) {
  const [title, setTitle] = useState(song?.title || '');
  const [artist, setArtist] = useState(song?.artist || '');
  const [songKey, setSongKey] = useState(song?.key || '');
  // Dialogs: plain notice, and confirm-before-removing-a-section
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);
  // Section picker popover (which block + which type is open)
  const [picker, setPicker] = useState<{ idx: number; type: SectionType } | null>(null);

  // Stanza Blocks representation
  const [blocks, setBlocks] = useState<SongBlock[]>(() => {
    if (song?.lyrics) {
      const parsed = parseLyricsToBlocks(song.lyrics);
      if (parsed.length > 0) return parsed;
    }
    return [
      {
        id: `block_1`,
        sectionType: 'verse',
        sectionLabel: 'Verso 1',
        lines: ['Escribe aquí la primera estrofa...'],
      },
    ];
  });

  // Text mode vs Section Blocks mode
  const [editorMode, setEditorMode] = useState<'blocks' | 'raw' | 'preview'>('blocks');
  const [rawText, setRawText] = useState<string>(() => (song?.lyrics ? stripChords(song.lyrics) : ''));

  // Text formatting options
  const [fontSize, setFontSize] = useState<number>(song?.customStyle?.fontSize || 19);
  const [fontFamily, setFontFamily] = useState<FontFamily>(
    song?.customStyle?.fontFamily && song.customStyle.fontFamily !== 'condensed' ? song.customStyle.fontFamily : 'sans'
  );
  const [lineHeight, setLineHeight] = useState<LineHeight>(song?.customStyle?.lineHeight || 'normal');
  const [align, setAlign] = useState<TextAlign>(song?.customStyle?.align || 'left');
  const [isBold, setIsBold] = useState<boolean>(song?.customStyle?.isBold || false);
  const [isItalic, setIsItalic] = useState<boolean>(song?.customStyle?.isItalic || false);
  const [textTransform, setTextTransform] = useState<TextTransform>(song?.customStyle?.textTransform || 'none');
  const [highlightChorus, setHighlightChorus] = useState<boolean>(song?.customStyle?.highlightChorus ?? true);

  const [showFormatPanel, setShowFormatPanel] = useState<boolean>(false);
  const [isSavedFeedback, setIsSavedFeedback] = useState<boolean>(false);

  // Keep rawText synced when switching modes
  const handleSwitchToRaw = () => {
    const fullLyrics = blocksToLyrics(blocks);
    setRawText(fullLyrics);
    setEditorMode('raw');
  };

  const handleSwitchToBlocks = () => {
    const parsed = parseLyricsToBlocks(rawText);
    setBlocks(parsed.length > 0 ? parsed : blocks);
    setEditorMode('blocks');
  };

  // Change section type (and visible name) for a block
  const handleSetSection = (blockIndex: number, type: SectionType, label: string) => {
    setBlocks((prev) => {
      const copy = [...prev];
      copy[blockIndex] = { ...copy[blockIndex], sectionType: type, sectionLabel: label };
      return copy;
    });
    setPicker(null);
  };

  // Update text inside a block
  const handleBlockLinesChange = (blockIndex: number, text: string) => {
    setBlocks((prev) => {
      const copy = [...prev];
      copy[blockIndex] = {
        ...copy[blockIndex],
        lines: text.split('\n'),
      };
      return copy;
    });
  };

  // Add new block with empty lines above and below
  const handleAddBlock = (indexAfter?: number) => {
    const newBlock: SongBlock = {
      id: `block_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sectionType: 'verse',
      sectionLabel: 'Verso',
      lines: [''],
    };

    setBlocks((prev) => {
      if (typeof indexAfter === 'number') {
        const copy = [...prev];
        copy.splice(indexAfter + 1, 0, newBlock);
        return copy;
      }
      return [...prev, newBlock];
    });
  };

  // Remove a block
  const handleRemoveBlock = (index: number) => {
    if (blocks.length <= 1) {
      setNotice({ title: 'Debe quedar una sección', message: 'Una canción necesita al menos una sección. Edita su texto o añade otra antes de eliminarla.' });
      return;
    }
    // Only ask when there is text to lose
    if (blocks[index].lines.some((l) => l.trim())) setPendingRemove(index);
    else setBlocks((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Move block up/down
  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    setBlocks((prev) => {
      const copy = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= copy.length) return prev;
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // Unsaved-changes tracking: compare a snapshot of every editable field against the initial one
  const snapshot = JSON.stringify({
    title,
    artist,
    songKey,
    lyrics: editorMode === 'raw' ? rawText.trim() : blocksToLyrics(blocks),
    fontSize,
    fontFamily,
    lineHeight,
    align,
    isBold,
    isItalic,
    textTransform,
    highlightChorus,
  });
  const initialSnapshot = useRef<string>(snapshot);
  const isDirty = snapshot !== initialSnapshot.current;
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);

  const handleBack = () => {
    if (isDirty) setShowLeavePrompt(true);
    else onBack();
  };

  // Ctrl/Cmd+S saves
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Save song
  const handleSave = () => {
    if (!title.trim()) {
      setNotice({ title: 'Falta el título', message: 'Escribe un título para la canción antes de guardarla.' });
      return;
    }

    const currentLyrics = editorMode === 'raw' ? rawText.trim() : blocksToLyrics(blocks);

    const updated: Song = {
      id: song?.id || `song_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      artist: artist.trim() || 'Artista Desconocido',
      album: song?.album,
      lyrics: currentLyrics,
      tempo: song?.tempo,
      key: songKey.trim() || undefined,
      createdAt: song?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: song?.isFavorite || false,
      source: song?.source || 'local',
      customStyle: {
        fontSize,
        fontFamily,
        lineHeight,
        align,
        isBold,
        isItalic,
        textTransform,
        highlightChorus,
      },
    };

    const saved = upsertSong(updated);
    setIsSavedFeedback(true);
    setTimeout(() => setIsSavedFeedback(false), 2000);
    onSaved(saved);
  };
  saveRef.current = handleSave;

  return (
    <div className="relative flex flex-col h-full bg-[color:var(--page)] text-[color:var(--ink)] overflow-hidden">
      {/* Aurora background */}
      <div className="pointer-events-none absolute -left-28 -top-16 w-[340px] h-[340px] rounded-full opacity-40 blur-[80px] bg-[oklch(0.72_0.15_70)]" />
      <div className="pointer-events-none absolute -right-36 top-[300px] w-[360px] h-[360px] rounded-full opacity-40 blur-[90px] bg-[oklch(0.62_0.17_300)]" />
      <div className="pointer-events-none absolute -left-20 -bottom-28 w-[300px] h-[300px] rounded-full opacity-30 blur-[80px] bg-[oklch(0.66_0.13_20)]" />

      {/* Top Header Bar */}
      <header className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-2.5 px-4 py-3 border-b border-white/10 bg-white/[0.06] backdrop-blur-xl backdrop-blur-md shrink-0">
        <button
          onClick={handleBack}
          className="order-1 mr-auto flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-2xl hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver</span>
        </button>

        {/* View/Editor Mode Toggles */}
        <div className="contents">
          <div className="order-3 w-full flex items-center justify-between bg-white/5 p-1 rounded-full border border-white/10 text-xs font-medium">
            <button
              onClick={() => {
                if (editorMode === 'raw') handleSwitchToBlocks();
                setEditorMode('blocks');
              }}
              className={`flex-1 justify-center flex items-center gap-1 px-2 py-1.5 rounded-full transition-colors ${
                editorMode === 'blocks'
                  ? 'bg-white/15 text-white font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Por Secciones</span>
            </button>
            <button
              onClick={handleSwitchToRaw}
              className={`flex-1 justify-center flex items-center gap-1 px-2 py-1.5 rounded-full transition-colors ${
                editorMode === 'raw'
                  ? 'bg-white/15 text-white font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Texto Libre</span>
            </button>
            <button
              onClick={() => {
                if (editorMode === 'raw') handleSwitchToBlocks();
                setEditorMode('preview');
              }}
              className={`flex-1 justify-center flex items-center gap-1 px-2 py-1.5 rounded-full transition-colors ${
                editorMode === 'preview'
                  ? 'bg-white/15 text-white font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Vista Previa</span>
            </button>
          </div>

          {/* Text Format Toggle Button */}
          <button
            onClick={() => setShowFormatPanel(!showFormatPanel)}
            className={`order-2 p-2 rounded-full border transition-colors ${
              showFormatPanel
                ? 'bg-[oklch(0.82_0.14_75)]/20 text-amber-400 border-amber-500/40'
                : 'text-zinc-400 border-white/10 hover:text-zinc-200 hover:bg-white/10'
            }`}
            title="Formato y tamaño de texto"
          >
            <Sliders className="w-4 h-4" />
          </button>

          {/* Save Button */}
          {isDirty && (
            <span className="order-2 flex items-center gap-1 text-[11px] font-semibold text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Sin guardar
            </span>
          )}
          <button
            onClick={handleSave}
            title="Guardar cambios (Ctrl+S)"
            className={`order-2 flex items-center gap-1.5 px-4 py-2 font-bold text-xs rounded-full transition-all shadow-sm ${
              isDirty
                ? 'bg-amber-400 hover:bg-amber-300 text-zinc-950 ring-2 ring-amber-400/40'
                : 'bg-white/10 text-zinc-300 hover:bg-white/15'
            }`}
          >
            {isSavedFeedback ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{isSavedFeedback ? 'Guardado' : isDirty ? 'Guardar cambios' : 'Guardar'}</span>
          </button>
        </div>
      </header>

      <ConfirmDialog
        open={showLeavePrompt}
        icon={<Save className="w-6 h-6" />}
        title="¿Guardar los cambios?"
        message="Tienes cambios sin guardar en esta canción."
        onClose={() => setShowLeavePrompt(false)}
        actions={[
          {
            label: 'Guardar y salir',
            tone: 'primary',
            onClick: () => {
              setShowLeavePrompt(false);
              handleSave();
            },
          },
          {
            label: 'Descartar cambios',
            tone: 'danger',
            onClick: () => {
              setShowLeavePrompt(false);
              onBack();
            },
          },
          { label: 'Seguir editando', onClick: () => setShowLeavePrompt(false) },
        ]}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        tone="danger"
        icon={<Trash2 className="w-6 h-6" />}
        title={pendingRemove !== null && blocks[pendingRemove] ? `¿Eliminar "${blocks[pendingRemove].sectionLabel}"?` : ''}
        message="Se borrará la sección con todo su texto. Puedes deshacerlo saliendo del editor sin guardar."
        onClose={() => setPendingRemove(null)}
        actions={[
          { label: 'Cancelar', onClick: () => setPendingRemove(null) },
          {
            label: 'Eliminar',
            tone: 'danger',
            onClick: () => {
              const idx = pendingRemove;
              setPendingRemove(null);
              if (idx !== null) setBlocks((prev) => prev.filter((_, i) => i !== idx));
            },
          },
        ]}
      />

      <ConfirmDialog
        open={!!notice}
        icon={<Info className="w-6 h-6" />}
        title={notice?.title ?? ''}
        message={notice?.message}
        onClose={() => setNotice(null)}
        actions={[{ label: 'Entendido', tone: 'primary', onClick: () => setNotice(null) }]}
      />

      {/* Text Format & Size Control Panel */}
      {showFormatPanel && (
        <div className="p-4 bg-white/[0.06] backdrop-blur-xl border-b border-white/10 shrink-0 space-y-3 animate-in slide-in-from-top-2 z-20 shadow-md">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Type className="w-4 h-4" />
              Formato de Texto y Tamaño
            </h4>
            <button
              onClick={() => setShowFormatPanel(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              ✕ Cerrar
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            {/* Font Size with Slider and A-/A+ */}
            <div>
              <div className="flex items-center justify-between text-zinc-300 mb-1">
                <span>Tamaño:</span>
                <span className="font-mono font-bold text-amber-400">{fontSize}px</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFontSize(Math.max(14, fontSize - 2))}
                  className="px-2.5 py-1 bg-black/25 border border-white/10 rounded font-bold hover:bg-white/10"
                >
                  A-
                </button>
                <input
                  type="range"
                  min={14}
                  max={38}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => setFontSize(Math.min(42, fontSize + 2))}
                  className="px-2.5 py-1 bg-black/25 border border-white/10 rounded font-bold hover:bg-white/10"
                >
                  A+
                </button>
              </div>
            </div>

            {/* Font Family Selector */}
            <div>
              <span className="block text-zinc-300 mb-1">Fuente:</span>
              <div className="grid grid-cols-2 gap-1">
                {(['sans', 'serif', 'mono'] as FontFamily[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFontFamily(f)}
                    className={`py-1 px-1.5 rounded text-[11px] font-medium border text-center transition-colors ${
                      fontFamily === f
                        ? 'border-amber-400 bg-amber-400/20 text-amber-300 font-bold'
                        : 'border-white/10 bg-black/25 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f === 'sans' ? 'Moderna' : f === 'serif' ? 'Serif' : 'Mono'}
                  </button>
                ))}
              </div>
            </div>

            {/* Formatting: Bold, Italic, Capitalize */}
            <div>
              <span className="block text-zinc-300 mb-1">Estilo y Énfasis:</span>
              <div className="flex items-center gap-1 bg-black/25 p-1 border border-white/10 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setIsBold(!isBold)}
                  className={`flex-1 py-1 rounded flex justify-center transition-colors ${
                    isBold ? 'bg-amber-400 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Negrita"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsItalic(!isItalic)}
                  className={`flex-1 py-1 rounded flex justify-center transition-colors ${
                    isItalic ? 'bg-amber-400 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Cursiva"
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTextTransform((curr) =>
                      curr === 'none' ? 'uppercase' : curr === 'uppercase' ? 'capitalize' : 'none'
                    )
                  }
                  className={`flex-1 py-1 rounded text-[10px] font-bold text-center transition-colors ${
                    textTransform !== 'none'
                      ? 'bg-amber-400 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Mayúsculas / Minúsculas"
                >
                  {textTransform === 'uppercase' ? 'MAY' : textTransform === 'capitalize' ? 'Abc' : 'Normal'}
                </button>
              </div>
            </div>

            {/* Text Alignment */}
            <div>
              <span className="block text-zinc-300 mb-1">Alineación:</span>
              <div className="flex items-center gap-1 bg-black/25 p-1 border border-white/10 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setAlign('left')}
                  className={`flex-1 py-1 rounded flex justify-center ${
                    align === 'left' ? 'bg-white/15 text-white' : 'text-zinc-400'
                  }`}
                  title="Alinear a la izquierda"
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setAlign('center')}
                  className={`flex-1 py-1 rounded flex justify-center ${
                    align === 'center' ? 'bg-white/15 text-white' : 'text-zinc-400'
                  }`}
                  title="Centrado"
                >
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setAlign('right')}
                  className={`flex-1 py-1 rounded flex justify-center ${
                    align === 'right' ? 'bg-white/15 text-white' : 'text-zinc-400'
                  }`}
                  title="Alinear a la derecha"
                >
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editor Content Body */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full space-y-4">
        {/* Title & Metadata Card */}
        <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-3xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Título de la Canción *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nombre de la canción"
                className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm font-bold text-white focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Artista o Banda</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Nombre del artista"
                className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-2xl text-sm text-zinc-200 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Tonalidad (opcional)</label>
              <input
                type="text"
                value={songKey}
                onChange={(e) => setSongKey(e.target.value)}
                placeholder="Ej. Am, G, F#m"
                className="w-full px-2.5 py-1.5 bg-black/25 border border-white/10 rounded-2xl text-zinc-200 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-zinc-400 bg-white/[0.04] rounded-2xl border border-white/10 opacity-50 cursor-not-allowed"
                title="Próximamente"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="leading-tight text-left">Auto-formatear secciones</span>
              </button>
            </div>
          </div>
        </div>

        {/* MODE 1: Interactive Stanza Blocks UX */}
        {editorMode === 'blocks' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
              <span>
                Cada sección está separada por un salto arriba y abajo. Asigna su sección con los botones rápidos:
              </span>
              <span className="font-semibold text-zinc-300">{blocks.length} secciones</span>
            </div>

            {blocks.map((block, idx) => {
              const isChorus = block.sectionType === 'chorus';
              return (
                <div
                  key={block.id || idx}
                  className={`bg-white/[0.06] backdrop-blur-xl border rounded-3xl transition-all ${
                    isChorus
                      ? 'border-amber-500/50 shadow-md shadow-amber-500/5'
                      : 'border-white/10'
                  }`}
                >
                  {/* Stanza Section Bar (Interactive Assignment Bar) */}
                  <div className="relative px-3.5 py-2 bg-black/25 border-b border-white/10 rounded-t-3xl flex flex-wrap items-center justify-between gap-2">
                    {/* 1-Tap Section Assignment Buttons */}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mr-1">
                        Sección:
                      </span>
                      {SECTION_DEFINITIONS.map((def) => {
                        const isSelected = block.sectionType === def.type;
                        const variants = SECTION_VARIANTS[def.type];
                        const isOpen = picker?.idx === idx && picker.type === def.type;
                        return (
                          <div key={def.type}>
                            <button
                              type="button"
                              onClick={() =>
                                variants
                                  ? setPicker(isOpen ? null : { idx, type: def.type })
                                  : handleSetSection(idx, def.type, def.label)
                              }
                              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all ${
                                isSelected
                                  ? 'bg-amber-400 text-zinc-950 font-bold shadow-xs'
                                  : 'bg-white/[0.06] hover:bg-white/10 text-zinc-300 border border-white/10'
                              }`}
                            >
                              {isSelected && variants ? compactSectionLabel(block.sectionLabel) : def.badge}
                            </button>

                            {isOpen && variants && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setPicker(null)} />
                                <div className="absolute left-3.5 top-full mt-1.5 z-30 flex gap-1 p-1.5 rounded-2xl bg-[color:var(--sheet)] border border-white/15 backdrop-blur-2xl shadow-xl">
                                  {Array.from({ length: variants.count + 1 }, (_, i) => i).map((n) => {
                                    const label = n === 0 ? variants.name : `${variants.name} ${n}`;
                                    const active = isSelected && block.sectionLabel === label;
                                    return (
                                      <button
                                        key={n}
                                        type="button"
                                        onClick={() => handleSetSection(idx, def.type, label)}
                                        title={label}
                                        className={`min-w-9 px-2.5 py-1.5 rounded-xl text-xs font-extrabold ${
                                          active ? 'bg-amber-400 text-zinc-950' : 'bg-white/10 hover:bg-white/20'
                                        }`}
                                      >
                                        {variants.short}
                                        {n || ''}
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Block Reordering & Deletion Controls */}
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveBlock(idx, 'up')}
                        className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 rounded hover:bg-white/10"
                        title="Mover sección arriba"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === blocks.length - 1}
                        onClick={() => handleMoveBlock(idx, 'down')}
                        className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 rounded hover:bg-white/10"
                        title="Mover sección abajo"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBlock(idx)}
                        className="p-1 text-zinc-500 hover:text-rose-400 rounded hover:bg-white/10"
                        title="Eliminar esta sección"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Section Label Custom Input & Stanza Content */}
                  <div className="p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">Nombre visible:</span>
                      <input
                        type="text"
                        value={block.sectionLabel}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBlocks((prev) => {
                            const copy = [...prev];
                            copy[idx] = { ...copy[idx], sectionLabel: val };
                            return copy;
                          });
                        }}
                        className="px-2 py-0.5 bg-black/25 border border-white/10 rounded text-xs font-bold text-amber-400 w-36 focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Textarea for Stanza Lines */}
                    <textarea
                      rows={Math.max(3, block.lines.length + 1)}
                      value={block.lines.join('\n')}
                      onChange={(e) => handleBlockLinesChange(idx, e.target.value)}
                      placeholder="Escribe las líneas de esta estrofa..."
                      className={`w-full p-3 bg-black/25 border border-white/10 rounded-2xl text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 resize-none ${getFontFamilyClass(
                        fontFamily
                      )} ${getLineHeightClass(lineHeight)} ${getTextAlignClass(align)} ${
                        isBold ? 'font-bold' : ''
                      } ${isItalic ? 'italic' : ''} ${getTextTransformClass(textTransform)}`}
                      style={{ fontSize: `${fontSize}px` }}
                    />
                  </div>

                  {/* Quick Add Stanza Directly Below */}
                  <div className="px-3 py-1.5 bg-black/20 border-t border-white/[0.08] rounded-b-3xl flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleAddBlock(idx)}
                      className="flex items-center gap-1 text-[11px] font-medium text-amber-400/90 hover:text-amber-300"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Insertar sección aquí abajo</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Bottom Add Section Button */}
            <button
              type="button"
              onClick={() => handleAddBlock()}
              className="w-full py-3 border-2 border-dashed border-white/10 hover:border-amber-400/80 rounded-3xl flex items-center justify-center gap-2 text-xs font-semibold text-zinc-300 hover:text-amber-400 bg-black/20 hover:bg-white/[0.08] transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir Nueva Sección (Con salto arriba y abajo)</span>
            </button>
          </div>
        )}

        {/* MODE 2: Raw Continuous Textarea */}
        {editorMode === 'raw' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
              <span>
                Separa cada estrofa con un salto arriba y abajo (doble salto de línea).
                Ejemplo: [Coro], [Verso 1], [Puente].
              </span>
            </div>
            <textarea
              rows={16}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`[Verso 1]\nLínea uno...\nLínea dos...\n\n[Coro]\nLínea del coro...\nLínea del coro...`}
              className={`w-full p-4 bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-3xl text-[color:var(--ink)] placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 resize-y leading-relaxed ${getFontFamilyClass(
                fontFamily
              )} ${getTextAlignClass(align)} ${isBold ? 'font-bold' : ''} ${
                isItalic ? 'italic' : ''
              } ${getTextTransformClass(textTransform)}`}
              style={{ fontSize: `${fontSize}px` }}
            />
          </div>
        )}

        {/* MODE 3: Live Preview */}
        {editorMode === 'preview' && (
          <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-3xl p-6 min-h-[400px]">
            <div className="border-b border-white/10 pb-4 mb-6">
              <h2 className="text-2xl font-bold text-white">{title || 'Título'}</h2>
              <p className="text-sm text-zinc-400">{artist || 'Artista'}</p>
            </div>

            <div
              className={`space-y-6 ${getFontFamilyClass(fontFamily)} ${getLineHeightClass(
                lineHeight
              )} ${getTextAlignClass(align)} ${isBold ? 'font-bold' : ''} ${
                isItalic ? 'italic' : ''
              } ${getTextTransformClass(textTransform)}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              {blocks.map((block, idx) => (
                <div key={idx} className="space-y-1">
                  {/* Section Label */}
                  <div className="pb-1.5">
                    <span className="inline-block text-xs font-bold uppercase tracking-widest text-amber-400 bg-amber-950/40 border border-amber-900/60 px-2.5 py-0.5 rounded">
                      {block.sectionLabel}
                    </span>
                  </div>
                  {/* Stanza lines */}
                  {block.lines.map((line, lIdx) => (
                    <div key={lIdx} className="leading-relaxed">
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
