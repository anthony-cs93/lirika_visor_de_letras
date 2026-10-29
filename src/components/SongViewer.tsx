import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  ChevronDown,
  ChevronUp,
  Moon,
  Sun,
  Flame,
  Type,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Edit3,
  Heart,
  ChevronRight,
  ChevronLeft,
  X,
  Radio,
  Gauge,
  Disc3,
  Sparkles,
} from 'lucide-react';
import {
  Song,
  ThemeMode,
  LyricsDisplayMode,
  FontFamily,
  LineHeight,
  TextAlign,
  TextTransform,
  SongBlock,
} from '../types/song';
import {
  parseLyricsToBlocks,
  getSectionMarks,
  compactSectionLabel,
} from '../utils/lyricsParser';
import {
  getFontFamilyClass,
  getLineHeightClass,
  getTextAlignClass,
  getTextTransformClass,
} from '../utils/theme';
import { toggleFavoriteSong } from '../utils/storage';
import { FavBurst } from './FavBurst';
import { randomFavMessage } from '../utils/favMessages';

type Panel = 'aa' | 'align' | 'speed' | null;

const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

interface SongViewerProps {
  song: Song;
  onBack: () => void;
  onEdit: (song: Song) => void;
}

export function SongViewer({
  song,
  onBack,
  onEdit,
}: SongViewerProps) {
  // Two Lyrics Display Modes: 'standard' (Actual con sombra) vs 'live' (Modo Live estilo Spotify)
  const [displayMode, setDisplayMode] = useState<LyricsDisplayMode>(
    song.customStyle?.displayMode || 'standard'
  );

  // Text formatting and styling
  const [fontSize, setFontSize] = useState<number>(song.customStyle?.fontSize || 20);
  const [fontFamily, setFontFamily] = useState<FontFamily>(
    song.customStyle?.fontFamily && song.customStyle.fontFamily !== 'condensed' ? song.customStyle.fontFamily : 'sans'
  );
  const [lineHeight, setLineHeight] = useState<LineHeight>(song.customStyle?.lineHeight || 'normal');
  const [align, setAlign] = useState<TextAlign>(song.customStyle?.align || 'left');
  const [isBold, setIsBold] = useState<boolean>(song.customStyle?.isBold || false);
  const [isItalic, setIsItalic] = useState<boolean>(song.customStyle?.isItalic || false);
  const [textTransform, setTextTransform] = useState<TextTransform>(song.customStyle?.textTransform || 'none');
  const [highlightChorus, setHighlightChorus] = useState<boolean>(song.customStyle?.highlightChorus ?? true);

  // Auto-scroll / Teleprompter State
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  // Auto-scroll config: pixels per second, or total duration of the song
  const savedScroll = (() => {
    try {
      return JSON.parse(localStorage.getItem('lirika_scroll') || 'null');
    } catch {
      return null;
    }
  })();
  const [scrollMode, setScrollMode] = useState<'px' | 'time'>(savedScroll?.mode === 'time' ? 'time' : 'px');
  const [scrollPx, setScrollPx] = useState<number>(savedScroll?.px || song.customStyle?.scrollSpeed || 28);
  const [scrollSecs, setScrollSecs] = useState<number>(savedScroll?.secs || 180);
  useEffect(() => {
    try {
      localStorage.setItem('lirika_scroll', JSON.stringify({ mode: scrollMode, px: scrollPx, secs: scrollSecs }));
    } catch {
      /* storage unavailable */
    }
  }, [scrollMode, scrollPx, scrollSecs]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isPausedByTouch, setIsPausedByTouch] = useState<boolean>(false);

  // Active selected section index
  const [currentBlockIndex, setCurrentBlockIndex] = useState<number>(0);

  // Drawer states
  const [panel, setPanel] = useState<Panel>(null);
  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const panelRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || dockRef.current?.contains(target)) return;
      setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [panel]);

  // Favorite toggle
  const [isFav, setIsFav] = useState<boolean>(!!song.isFavorite);

  // Refs for scrolling container & animation frame
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const blockRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Screen Wake Lock API
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Ignored
      }
    };
    requestWakeLock();
    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  // Parse stanzas/blocks separated by line breaks
  const blocks: SongBlock[] = parseLyricsToBlocks(song.lyrics);
  const sectionMarks = getSectionMarks(blocks);

  // Navigation handlers (for both modes)
  // Top of a block measured inside the scroll container (offsetTop is relative to the wrong ancestor here)
  const blockTop = (el: HTMLElement, container: HTMLElement) =>
    el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

  // Bumped on every jump; the effect below centers the block once the new selection has re-laid-out
  // (the previously selected block shrinks when deselected, which shifts everything after it).
  const [centerTick, setCenterTick] = useState(0);

  // Direction of the last section change (1 = forward, -1 = back) drives the Live slide animation
  const lastIndexRef = useRef(currentBlockIndex);
  const slideDirRef = useRef(1);
  if (lastIndexRef.current !== currentBlockIndex) {
    slideDirRef.current = currentBlockIndex > lastIndexRef.current ? 1 : -1;
    lastIndexRef.current = currentBlockIndex;
  }
  const slideClass =
    slideDirRef.current === 1
      ? 'animate-[slideFromBottom_0.42s_cubic-bezier(0.2,0.9,0.3,1)]'
      : 'animate-[slideFromTop_0.42s_cubic-bezier(0.2,0.9,0.3,1)]';

  const jumpToBlock = (bIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(blocks.length - 1, bIndex));
    setCurrentBlockIndex(clampedIndex);
    if (displayMode === 'standard') setCenterTick((t) => t + 1);
  };

  useEffect(() => {
    if (centerTick === 0 || displayMode !== 'standard') return;
    const el = blockRefs.current.get(currentBlockIndex);
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    // Center the section in the area above the dock (the bottom ~130px is covered by controls)
    const visibleHeight = container.clientHeight - 130;
    container.scrollTo({
      top: blockTop(el, container) - (visibleHeight - el.offsetHeight) / 2,
      behavior: 'smooth',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTick]);

  const handleNextSection = () => {
    if (currentBlockIndex < blocks.length - 1) {
      jumpToBlock(currentBlockIndex + 1);
    }
  };

  const handlePrevSection = () => {
    if (currentBlockIndex > 0) {
      jumpToBlock(currentBlockIndex - 1);
    }
  };

  // Continuous Auto-Scroll Engine (for Standard Mode) or Section Pace (for Live Mode)
  useEffect(() => {
    if (!isScrolling || isPausedByTouch) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    if (displayMode === 'standard') {
      const scrollLoop = (time: number) => {
        if (lastTimeRef.current === null) {
          lastTimeRef.current = time;
        }
        const delta = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;

        const container = scrollContainerRef.current;
        if (container) {
          const speed =
            scrollMode === 'px'
              ? scrollPx
              : Math.max(1, (container.scrollHeight - container.clientHeight) / scrollSecs);
          const deltaPx = speed * delta;
          container.scrollTop += deltaPx;

          // Check if bottom reached
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
            setIsScrolling(false);
            return;
          }

          // Determine current active section based on scroll offset
          for (let i = blocks.length - 1; i >= 0; i--) {
            const el = blockRefs.current.get(i);
            if (el && blockTop(el, container) <= container.scrollTop + 140) {
              setCurrentBlockIndex(i);
              break;
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(scrollLoop);
      };

      animFrameRef.current = requestAnimationFrame(scrollLoop);
    } else {
      // In Live Mode: auto-advance section after estimated duration based on line count and scrollSpeed
      const currentBlock = blocks[currentBlockIndex];
      const lineCount = currentBlock ? currentBlock.lines.length : 4;
      const durationMs =
        scrollMode === 'px'
          ? Math.max(3000, ((lineCount * 36) / scrollPx) * 1000)
          : Math.max(1500, (scrollSecs * 1000) / Math.max(1, blocks.length));

      const timer = setTimeout(() => {
        if (currentBlockIndex < blocks.length - 1) {
          setCurrentBlockIndex((prev) => prev + 1);
        } else {
          setIsScrolling(false);
        }
      }, durationMs);

      return () => clearTimeout(timer);
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isScrolling, isPausedByTouch, scrollMode, scrollPx, scrollSecs, displayMode, blocks, currentBlockIndex]);

  // Lead-in countdown
  const startWithCountdown = () => {
    if (isScrolling) {
      setIsScrolling(false);
      return;
    }

    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setIsScrolling(true);
          return null;
        }
        return prev - 1;
      });
    }, 800);
  };

  const skipCountdown = () => {
    setCountdown(null);
    setIsScrolling(true);
  };

  const resetToTop = () => {
    setIsScrolling(false);
    setCurrentBlockIndex(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleTouchStart = () => {
    if (isScrolling) setIsPausedByTouch(true);
  };

  const handleTouchEnd = () => {
    if (isScrolling && isPausedByTouch) {
      setTimeout(() => setIsPausedByTouch(false), 1500);
    }
  };

  const [burst, setBurst] = useState<{ text: string; n: number } | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleToggleFav = () => {
    const next = toggleFavoriteSong(song.id);
    clearTimeout(burstTimer.current);
    if (next) {
      setBurst((prev) => ({ text: randomFavMessage(prev?.text), n: (prev?.n ?? 0) + 1 }));
      burstTimer.current = setTimeout(() => setBurst(null), 1600);
    } else {
      setBurst(null);
    }
    setIsFav(next);
  };

  // Blocks for Live Mode (anterior, actual, posterior)
  const prevBlock = currentBlockIndex > 0 ? blocks[currentBlockIndex - 1] : null;
  const currentBlock = blocks[currentBlockIndex] || blocks[0];
  const nextBlock = currentBlockIndex < blocks.length - 1 ? blocks[currentBlockIndex + 1] : null;

  const AMBER = 'bg-[oklch(0.82_0.14_75)] text-[#17130a]';
  const GLASS = 'bg-white/[0.07] border border-white/[0.14] backdrop-blur-xl';
  const DOCK = 'bg-[color:var(--dock)] border border-white/[0.16] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)]';
  const isLive = displayMode === 'live';
  const textStyleClasses = `${getFontFamilyClass(fontFamily)} ${getLineHeightClass(lineHeight)} ${getTextAlignClass(
    align
  )} ${isBold ? 'font-bold' : ''} ${isItalic ? 'italic' : ''} ${getTextTransformClass(textTransform)}`;
  const previewStyleClasses = `${getFontFamilyClass(fontFamily)} ${getTextAlignClass(align)} ${
    isBold ? 'font-bold' : ''
  } ${isItalic ? 'italic' : ''} ${getTextTransformClass(textTransform)}`;
  const seg = (active: boolean) =>
    `flex-1 text-center py-2 rounded-xl text-xs font-bold cursor-pointer transition-all ${
      active ? 'bg-white/20' : 'opacity-70'
    }`;

  return (
    <div className="relative flex flex-col h-full select-none overflow-hidden bg-[color:var(--page)] text-[color:var(--ink)]">
      {/* Aurora background */}
      <div className="pointer-events-none absolute -left-28 -top-16 w-[340px] h-[340px] rounded-full opacity-[0.18] blur-[80px] bg-[oklch(0.72_0.15_70)]" />
      <div className="pointer-events-none absolute -right-36 top-[300px] w-[360px] h-[360px] rounded-full opacity-[0.26] blur-[90px] bg-[oklch(0.62_0.17_300)]" />
      <div className="pointer-events-none absolute -left-20 -bottom-28 w-[300px] h-[300px] rounded-full opacity-[0.18] blur-[80px] bg-[oklch(0.66_0.13_20)]" />

      {/* Lead-in countdown */}
      {countdown !== null && (
        <div
          onClick={skipCountdown}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md cursor-pointer"
        >
          <span className="text-8xl font-black text-[oklch(0.82_0.14_75)] animate-ping">{countdown}</span>
          <p className="mt-4 text-sm font-semibold opacity-70">Toca para comenzar de inmediato</p>
        </div>
      )}

      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pt-9 shrink-0">
          <button
            onClick={onBack}
            className={`w-[42px] h-[42px] rounded-full flex items-center justify-center shrink-0 hover:bg-white/15 ${GLASS}`}
            title="Volver"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="text-[15px] font-extrabold truncate">{song.title}</div>
            <div className="text-xs opacity-60 truncate">{song.artist}</div>
          </div>
          <button
            onClick={handleToggleFav}
            className={`relative w-[42px] h-[42px] rounded-full flex items-center justify-center shrink-0 hover:bg-white/15 ${GLASS} ${
              isFav ? 'text-[oklch(0.75_0.17_10)]' : ''
            }`}
            title="Favorito"
          >
            <Heart className={`w-[18px] h-[18px] ${isFav ? 'fill-current' : ''}`} />
            {burst && <FavBurst key={burst.n} text={burst.text} />}
          </button>
        </div>

        {/* Mode switch */}
        <div className="flex justify-center pt-3.5 shrink-0">
          <div className={`flex p-1 rounded-full ${GLASS}`}>
            <button
              onClick={() => setDisplayMode('standard')}
              className={`px-5 py-2 rounded-full text-[13px] font-extrabold transition-all ${
                !isLive ? AMBER : ''
              }`}
            >
              Full
            </button>
            <button
              onClick={() => setDisplayMode('live')}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-extrabold transition-all ${
                isLive ? AMBER : ''
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.65_0.22_25)]" />
              Live
            </button>
          </div>
        </div>

        {/* Section chips */}
        {sectionMarks.length > 0 && (
          <div className="flex gap-2 px-4 pt-3.5 overflow-x-auto no-scrollbar shrink-0">
            {sectionMarks.map((sec, sIdx) => {
              const isCurrent = currentBlockIndex === sec.blockIndex;
              return (
                <button
                  key={sIdx}
                  onClick={() => jumpToBlock(sec.blockIndex)}
                  title={sec.label}
                  className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                    isCurrent
                      ? 'bg-[oklch(0.82_0.14_75)] text-[#17130a] border-[oklch(0.82_0.14_75)]'
                      : 'bg-white/[0.07] border-white/[0.12]'
                  }`}
                >
                  {compactSectionLabel(sec.label)}
                </button>
              );
            })}
          </div>
        )}

        {/* Lyrics */}
        {isLive ? (
          <div
            className="flex-1 flex flex-col justify-center gap-[18px] px-5 pb-36 overflow-y-auto no-scrollbar"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div
              key={`prev-${currentBlockIndex}`}
              onClick={handlePrevSection}
              className={`opacity-30 blur-[1.2px] hover:opacity-60 hover:blur-none cursor-pointer min-h-16 flex flex-col justify-end gap-0.5 text-[15px] font-semibold transition-[opacity,filter] duration-300 ${previewStyleClasses} ${slideClass}`}
            >
              {prevBlock ? (
                prevBlock.lines.slice(-2).map((l, i) => (
                  <div key={i} className="truncate">
                    {l}
                  </div>
                ))
              ) : (
                <div>Inicio</div>
              )}
            </div>

            <div
              key={`cur-${currentBlockIndex}`}
              className={`${textStyleClasses} ${slideClass}`}
            >
              <div className="flex justify-between mb-4 pr-1 text-[11px] font-extrabold tracking-[0.14em] uppercase text-[oklch(0.85_0.13_75)]">
                <span>{currentBlock.sectionLabel}</span>
                <span className="opacity-60 text-[color:var(--ink)] tracking-wider">
                  {currentBlockIndex + 1} / {blocks.length}
                </span>
              </div>
              <div className={align === 'center' ? 'px-12' : 'pr-12'}>
                {currentBlock.lines.map((line, i) => (
                  <div
                    key={i}
                    className="font-extrabold tracking-tight mt-1.5 leading-[1.28]"
                    style={{ fontSize: `${fontSize + 9}px` }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div
              key={`next-${currentBlockIndex}`}
              onClick={handleNextSection}
              className={`opacity-30 blur-[1.2px] hover:opacity-60 hover:blur-none cursor-pointer min-h-16 flex flex-col gap-0.5 text-[15px] font-semibold transition-[opacity,filter] duration-300 ${previewStyleClasses} ${slideClass}`}
            >
              {nextBlock ? (
                nextBlock.lines.slice(0, 2).map((l, i) => (
                  <div key={i} className="truncate">
                    {l}
                  </div>
                ))
              ) : (
                <div>Final</div>
              )}
            </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-44 scroll-smooth focus:outline-none [mask-image:linear-gradient(transparent,#000_14px,#000_calc(100%-150px),transparent)]"
          >
            <div className={`flex flex-col gap-3 ${textStyleClasses}`} style={{ fontSize: `${fontSize}px` }}>
              {blocks.map((block, index) => {
                const isSelected = currentBlockIndex === index;
                const isChorus = block.sectionType === 'chorus' && highlightChorus;
                return (
                  <div
                    key={block.id || index}
                    ref={(el) => {
                      if (el) blockRefs.current.set(index, el);
                    }}
                    onClick={() => jumpToBlock(index)}
                    className={`shrink-0 px-[18px] py-4 rounded-[26px] cursor-pointer backdrop-blur-xl border transition-all duration-300 ${
                      isSelected
                        ? 'bg-white/[0.12] border-white/[0.26] opacity-100'
                        : isChorus
                        ? 'bg-[oklch(0.75_0.14_75_/_0.1)] border-[oklch(0.8_0.13_75_/_0.3)] opacity-50'
                        : 'bg-white/[0.04] border-white/[0.08] opacity-50'
                    }`}
                  >
                    <div
                      className={`text-[11px] font-extrabold tracking-[0.14em] uppercase mb-2 ${
                        isSelected || isChorus ? 'text-[oklch(0.85_0.13_75)]' : 'text-[color:var(--ink)]/55'
                      }`}
                    >
                      {block.sectionLabel}
                    </div>
                    {block.lines.map((line, lIdx) => (
                      <div
                        key={lIdx}
                        className={`leading-[1.45] tracking-tight ${isSelected ? 'font-bold' : 'font-medium'}`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="py-8 text-center text-xs opacity-40">Fin de la canción</div>
            </div>
          </div>
        )}

        {/* Touch pause pill */}
        {isPausedByTouch && isScrolling && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-[oklch(0.82_0.14_75)] text-[#17130a] font-bold text-xs flex items-center gap-1.5 animate-pulse">
            <Pause className="w-3.5 h-3.5" />
            Pausa por toque
          </div>
        )}

        {/* Floating section navigation (outside the dock) */}
        <div
          className={`absolute right-3.5 bottom-[118px] z-10 flex flex-col gap-1.5 p-1.5 rounded-full ${DOCK} ring-1 ring-[oklch(0.82_0.14_75_/_0.45)] transition-all duration-200 ${
            panel ? 'opacity-0 pointer-events-none translate-y-2' : ''
          }`}
        >
          {([
            ['up', handlePrevSection, currentBlockIndex === 0, 'Sección anterior', ChevronUp],
            ['down', handleNextSection, currentBlockIndex >= blocks.length - 1, 'Siguiente sección', ChevronDown],
          ] as const).map(([k, onClick, disabled, title, Icon]) => (
            <button
              key={k}
              onClick={onClick}
              disabled={disabled}
              title={title}
              className={`w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all active:scale-90 ${AMBER} shadow-[0_6px_18px_oklch(0.72_0.15_70_/_0.45)] disabled:opacity-30 disabled:shadow-none disabled:grayscale`}
            >
              <Icon className="w-7 h-7" strokeWidth={3.2} />
            </button>
          ))}
        </div>

        {/* Option panels (one per dock button) */}
        {panel && (
          <div
            key={panel}
            ref={panelRef}
            className="absolute left-3.5 right-3.5 bottom-[118px] z-20 p-[18px] rounded-[28px] bg-[color:var(--sheet)] border border-white/[0.18] backdrop-blur-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col gap-3.5 max-h-[55%] overflow-y-auto no-scrollbar animate-[sheetIn_0.22s_cubic-bezier(0.2,0.9,0.3,1)]"
          >
            {panel === 'aa' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-extrabold w-14">Tamaño</span>
                  <button
                    onClick={() => setFontSize((v) => Math.max(14, v - 1))}
                    className="w-9 h-9 rounded-full bg-white/10 text-[13px] font-extrabold active:scale-90 transition-transform"
                  >
                    A−
                  </button>
                  <input
                    type="range"
                    min={14}
                    max={42}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="flex-1 accent-[oklch(0.82_0.14_75)]"
                  />
                  <button
                    onClick={() => setFontSize((v) => Math.min(42, v + 1))}
                    className="w-9 h-9 rounded-full bg-white/10 text-[15px] font-extrabold active:scale-90 transition-transform"
                  >
                    A+
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-extrabold w-14">Fuente</span>
                  <div className="flex-1 flex p-[3px] rounded-2xl bg-white/[0.08]">
                    {(['sans', 'serif', 'mono'] as FontFamily[]).map((f) => (
                      <button key={f} onClick={() => setFontFamily(f)} className={seg(fontFamily === f)}>
                        {f === 'sans' ? 'Moderna' : f === 'serif' ? 'Serif' : 'Mono'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-extrabold w-14">Estilo</span>
                  <div className="flex-1 flex p-[3px] rounded-2xl bg-white/[0.08]">
                    <button onClick={() => setIsBold(!isBold)} className={`${seg(isBold)} flex justify-center`} title="Negrita">
                      <Bold className="w-4 h-4" />
                    </button>
                    <button onClick={() => setIsItalic(!isItalic)} className={`${seg(isItalic)} flex justify-center`} title="Cursiva">
                      <Italic className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        setTextTransform((c) => (c === 'none' ? 'uppercase' : c === 'uppercase' ? 'capitalize' : 'none'))
                      }
                      className={seg(textTransform !== 'none')}
                      title="Mayúsculas / Minúsculas"
                    >
                      {textTransform === 'uppercase' ? 'MAY' : textTransform === 'capitalize' ? 'Abc' : 'Nor'}
                    </button>
                  </div>
                </div>
                <div
                  onClick={() => setHighlightChorus(!highlightChorus)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span className="text-[13px] font-extrabold">Resaltar coro</span>
                  <span
                    className={`relative w-[46px] h-7 rounded-full transition-all ${
                      highlightChorus ? 'bg-[oklch(0.82_0.14_75)]' : 'bg-white/[0.18]'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white transition-all ${
                        highlightChorus ? 'left-[21px]' : 'left-[3px]'
                      }`}
                    />
                  </span>
                </div>
              </>
            )}

            {panel === 'align' && (
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-extrabold w-14">Alinear</span>
                <div className="flex-1 flex p-[3px] rounded-2xl bg-white/[0.08]">
                  {(
                    [
                      ['left', AlignLeft],
                      ['center', AlignCenter],
                      ['right', AlignRight],
                    ] as const
                  ).map(([k, Icon]) => (
                    <button key={k} onClick={() => setAlign(k)} className={`${seg(align === k)} flex justify-center`}>
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {panel === 'speed' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-extrabold w-14">Scroll</span>
                  <div className="flex-1 flex p-[3px] rounded-2xl bg-white/[0.08]">
                    <button onClick={() => setScrollMode('px')} className={seg(scrollMode === 'px')}>
                      Píxeles / seg
                    </button>
                    <button onClick={() => setScrollMode('time')} className={seg(scrollMode === 'time')}>
                      Tiempo total
                    </button>
                  </div>
                </div>
                {scrollMode === 'px' ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-extrabold w-14">Velocidad</span>
                    <input
                      type="range"
                      min={8}
                      max={120}
                      step={2}
                      value={scrollPx}
                      onChange={(e) => setScrollPx(Number(e.target.value))}
                      className="flex-1 accent-[oklch(0.82_0.14_75)]"
                    />
                    <span className="w-16 text-right text-xs font-bold tabular-nums">{scrollPx} px/s</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-extrabold w-14">Duración</span>
                      <input
                        type="range"
                        min={30}
                        max={600}
                        step={10}
                        value={scrollSecs}
                        onChange={(e) => setScrollSecs(Number(e.target.value))}
                        className="flex-1 accent-[oklch(0.82_0.14_75)]"
                      />
                      <span className="w-16 text-right text-xs font-bold tabular-nums">{formatTime(scrollSecs)}</span>
                    </div>
                    <p className="text-[11px] opacity-60 -mt-1">
                      La letra se recorre completa en ese tiempo (≈ {Math.round(scrollSecs / Math.max(1, blocks.length))} s por sección en Live).
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Dock */}
        <div
          ref={dockRef}
          className={`absolute left-3.5 right-3.5 bottom-6 h-[84px] rounded-full px-3 z-10 grid grid-cols-[1fr_auto_1fr] items-center ${DOCK}`}
        >
          <div className="flex items-center justify-evenly">
            {(
              [
                ['aa', 'Tamaño, fuente y estilo'],
                ['align', 'Alineación'],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id}
                onClick={() => togglePanel(id)}
                title={title}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-extrabold transition-all duration-150 active:scale-90 ${
                  panel === id ? `${AMBER} animate-[pop_0.28s_ease-out]` : 'bg-white/[0.09]'
                }`}
              >
                {id === 'aa' ? (
                  'Aa'
                ) : align === 'center' ? (
                  <AlignCenter className="w-[18px] h-[18px]" />
                ) : align === 'right' ? (
                  <AlignRight className="w-[18px] h-[18px]" />
                ) : (
                  <AlignLeft className="w-[18px] h-[18px]" />
                )}
              </button>
            ))}
          </div>

          <button
            onClick={startWithCountdown}
            className={`mx-1 w-[62px] h-[62px] rounded-full flex items-center justify-center shadow-[0_8px_28px_oklch(0.72_0.15_70_/_0.5)] active:scale-95 transition-transform ${AMBER}`}
            title={isScrolling ? 'Pausar auto-avance' : 'Auto-avance'}
          >
            {isScrolling ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
          </button>

          <div className="flex items-center justify-evenly">
            <button
              onClick={() => togglePanel('speed')}
              title="Velocidad del scroll"
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 ${
                panel === 'speed' ? `${AMBER} animate-[pop_0.28s_ease-out]` : 'bg-white/[0.09]'
              }`}
            >
              <Gauge className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => onEdit(song)}
              className="w-10 h-10 rounded-full bg-white/[0.09] flex items-center justify-center active:scale-90 transition-transform"
              title="Editar letra"
            >
              <Edit3 className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
