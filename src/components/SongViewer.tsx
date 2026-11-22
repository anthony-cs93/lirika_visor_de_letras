import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  Share2,
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
  paginateLines,
} from '../utils/lyricsParser';
import {
  getFontFamilyClass,
  getLineHeightClass,
  getTextAlignClass,
  getTextTransformClass,
} from '../utils/theme';
import { toggleFavoriteSong } from '../utils/storage';
import { shareSong, copySongText, hasSystemShare } from '../utils/share';
import { ConfirmDialog } from './ConfirmDialog';
import { FavBurst } from './FavBurst';
import { usePinGuard } from './PinGuard';
import { randomFavMessage } from '../utils/favMessages';

type Panel = 'aa' | 'align' | 'speed' | null;

const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

interface ViewStyle {
  fontSize: number;
  fontFamily: FontFamily;
  lineHeight: LineHeight;
  align: TextAlign;
  isBold: boolean;
  isItalic: boolean;
  textTransform: TextTransform;
}

interface SongViewerProps {
  song: Song;
  onBack: () => void;
  onEdit: (song: Song, blockIndex: number) => void;
}

export function SongViewer({
  song,
  onBack,
  onEdit,
}: SongViewerProps) {
  const { guard, pinDialog } = usePinGuard();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const showShareToast = (msg: string) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(null), 2000);
  };
  // Two Lyrics Display Modes: 'standard' (Actual con sombra) vs 'live' (Modo Live estilo Spotify)
  const [displayMode, setDisplayMode] = useState<LyricsDisplayMode>(
    song.customStyle?.displayMode || 'standard'
  );

  // Text formatting and styling. Each display mode (Full / Live) keeps its own copy, so changing
  // size, font, style or alignment in one mode never affects the other. Both start from the song's saved style.
  const [styles, setStyles] = useState<Record<LyricsDisplayMode, ViewStyle>>(() => {
    const initial = (): ViewStyle => ({
      fontSize: song.customStyle?.fontSize || 20,
      fontFamily:
        song.customStyle?.fontFamily && song.customStyle.fontFamily !== 'condensed' ? song.customStyle.fontFamily : 'sans',
      lineHeight: song.customStyle?.lineHeight || 'normal',
      align: song.customStyle?.align || 'left',
      isBold: song.customStyle?.isBold || false,
      isItalic: song.customStyle?.isItalic || false,
      textTransform: song.customStyle?.textTransform || 'none',
    });
    return { standard: initial(), live: initial() };
  });
  const { fontSize, fontFamily, lineHeight, align, isBold, isItalic, textTransform } = styles[displayMode];
  // Setters write to the style of the mode currently on screen
  const setStyleField = <K extends keyof ViewStyle>(key: K, value: ViewStyle[K] | ((current: ViewStyle[K]) => ViewStyle[K])) =>
    setStyles((prev) => {
      const current = prev[displayMode];
      const next = typeof value === 'function' ? (value as (c: ViewStyle[K]) => ViewStyle[K])(current[key]) : value;
      return { ...prev, [displayMode]: { ...current, [key]: next } };
    });
  const setFontSize = (v: number | ((c: number) => number)) => setStyleField('fontSize', v);
  const setFontFamily = (v: FontFamily) => setStyleField('fontFamily', v);
  const setLineHeight = (v: LineHeight) => setStyleField('lineHeight', v);
  const setAlign = (v: TextAlign) => setStyleField('align', v);
  const setIsBold = (v: boolean) => setStyleField('isBold', v);
  const setIsItalic = (v: boolean) => setStyleField('isItalic', v);
  const setTextTransform = (v: TextTransform | ((c: TextTransform) => TextTransform)) => setStyleField('textTransform', v);
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
  // Live: current page inside a long section
  const [livePage, setLivePage] = useState(0);

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

  // Live section controls: long-press to drag them, they snap to the nearest side (left/right)
  const NAV_HOLD_MS = 700;
  const NAV_MARGIN_PX = 14; // same as left-3.5 / right-3.5
  const NAV_BOTTOM_PX = 84; // default distance from the bottom (above the dock)
  const NAV_TOP_LIMIT_PX = 120; // never closer than this to the top (header and chips)
  const NAV_Y_KEY = 'lirika_nav_y';
  const NAV_SIDE_KEY = 'lirika_nav_side';
  const [navSide, setNavSide] = useState<'left' | 'right'>(() => {
    try {
      return localStorage.getItem(NAV_SIDE_KEY) === 'left' ? 'left' : 'right';
    } catch {
      return 'right';
    }
  });
  // Extra distance above the default bottom position (px); the control can be moved up but not over the dock
  const [navLift, setNavLift] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(NAV_Y_KEY));
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0;
    }
  });
  const [navDx, setNavDx] = useState(0);
  const [navDy, setNavDy] = useState(0);
  const [navHeld, setNavHeld] = useState(false); // long press armed: the control follows the finger
  const navRef = useRef<HTMLDivElement>(null);
  const navPress = useRef<{ id: number; x: number; y: number; baseLeft: number; baseTop: number; held: boolean; timer: number } | null>(null);
  const navJustDragged = useRef(false);
  const navSlideFrom = useRef<string | null>(null);
  const [navSlideTick, setNavSlideTick] = useState(0);

  const handleNavPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = navRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      baseLeft: el.getBoundingClientRect().left - parent.getBoundingClientRect().left,
      baseTop: el.getBoundingClientRect().top - parent.getBoundingClientRect().top,
      held: false,
      timer: 0,
    };
    press.timer = window.setTimeout(() => {
      press.held = true;
      setNavHeld(true);
      try {
        el.setPointerCapture(press.id);
      } catch {
        // pointer already gone
      }
      navigator.vibrate?.(15);
    }, NAV_HOLD_MS);
    navPress.current = press;
  };

  const handleNavPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = navPress.current;
    const el = navRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!press || !el || !parent) return;
    if (!press.held) {
      // Moved before the hold finished: it is a normal gesture, not a drag
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        navPress.current = null;
      }
      return;
    }
    const min = -press.baseLeft;
    const max = parent.clientWidth - el.offsetWidth - press.baseLeft;
    setNavDx(Math.max(min, Math.min(max, e.clientX - press.x)));
    // Vertical: up to the top limit, down to the default position
    const minY = NAV_TOP_LIMIT_PX - press.baseTop;
    const maxY = navLift;
    setNavDy(Math.max(minY, Math.min(maxY, e.clientY - press.y)));
  };

  const endNavPress = () => {
    const press = navPress.current;
    const el = navRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    navPress.current = null;
    if (!press) return;
    clearTimeout(press.timer);
    if (!press.held || !el || !parent) return;

    // Snap to the nearest side; the final position is applied at once and the slide starts from where it was dropped
    const left = press.baseLeft + navDx;
    const side = left + el.offsetWidth / 2 < parent.clientWidth / 2 ? 'left' : 'right';
    const targetLeft = side === 'left' ? NAV_MARGIN_PX : parent.clientWidth - el.offsetWidth - NAV_MARGIN_PX;
    const lift = Math.max(0, navLift - navDy); // moving down (dy > 0) lowers the control
    navSlideFrom.current = `translate(${left - targetLeft}px, 0px) scale(1.08)`;
    setNavSide(side);
    setNavLift(lift);
    setNavDx(0);
    setNavDy(0);
    setNavHeld(false);
    setNavSlideTick((t) => t + 1);
    try {
      localStorage.setItem(NAV_SIDE_KEY, side);
      localStorage.setItem(NAV_Y_KEY, String(Math.round(lift)));
    } catch {
      // storage unavailable
    }
    navJustDragged.current = true; // the release must not count as a tap on a button
    setTimeout(() => (navJustDragged.current = false), 80);
  };

  // Runs after the new side is rendered: animate from the drop position to the snapped one
  useLayoutEffect(() => {
    const from = navSlideFrom.current;
    const el = navRef.current;
    navSlideFrom.current = null;
    if (!from || !el) return;
    el.animate([{ transform: from }, { transform: 'translate(0px, 0px) scale(1)' }], {
      duration: 240,
      easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
    });
  }, [navSlideTick]);

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

  // Page changes inside one section: the lines slide in (title and dots stay still). A section change
  // remounts the whole block, which already animates, so it must not add a page animation on top.
  const lastPageRef = useRef({ block: currentBlockIndex, page: livePage });
  const pageSlideRef = useRef<'' | 'next' | 'prev'>('');
  if (lastPageRef.current.block !== currentBlockIndex) {
    pageSlideRef.current = '';
  } else if (lastPageRef.current.page !== livePage) {
    pageSlideRef.current = livePage > lastPageRef.current.page ? 'next' : 'prev';
  }
  lastPageRef.current = { block: currentBlockIndex, page: livePage };
  const pageSlideClass =
    pageSlideRef.current === 'next'
      ? 'animate-[pageFromBottom_0.3s_cubic-bezier(0.2,0.9,0.3,1)]'
      : pageSlideRef.current === 'prev'
        ? 'animate-[pageFromTop_0.3s_cubic-bezier(0.2,0.9,0.3,1)]'
        : '';

  // Keep the active section chip visible in the chips row (card tap -> chip, mirrors chip tap -> card)
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipsRef.current;
    // A run of repeated sections shares one chip, keyed by the first section of the run
    const runStart = currentBlockIndex - ((sectionMarks[currentBlockIndex]?.repeat ?? 1) - 1);
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${runStart}"]`);
    if (!row || !chip) return;
    const c = chip.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const left = row.scrollLeft + (c.left - r.left) - (r.width - c.width) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [currentBlockIndex]);

  // While a chip-triggered smooth scroll runs, scroll events must not overwrite the chosen section
  const syncLockUntil = useRef(0);
  const syncLockMax = useRef(0);

  const jumpToBlock = (bIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(blocks.length - 1, bIndex));
    setCurrentBlockIndex(clampedIndex);
    setLivePage(0);
    if (displayMode === 'standard') {
      syncLockUntil.current = Date.now() + 900;
      syncLockMax.current = Date.now() + 2500;
      setCenterTick((t) => t + 1);
    }
  };

  // Full mode: the active chip follows what is on screen (reading line ~30% down the visible area)
  const syncSectionWithScroll = () => {
    const now = Date.now();
    if (now < syncLockUntil.current) {
      // Still animating towards the tapped chip: keep the lock while scroll events keep coming (capped)
      syncLockUntil.current = Math.min(Math.max(syncLockUntil.current, now + 150), syncLockMax.current);
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const probe = container.scrollTop + (container.clientHeight - 80) * 0.3;
    let active = 0;
    for (let i = 0; i < blocks.length; i++) {
      const el = blockRefs.current.get(i);
      if (el && blockTop(el, container) <= probe) active = i;
    }
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 5) active = blocks.length - 1;
    setCurrentBlockIndex(active);
  };

  useEffect(() => {
    if (centerTick === 0 || displayMode !== 'standard') return;
    const el = blockRefs.current.get(currentBlockIndex);
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    // Bring the section to the top of the view (the bottom ~80px is covered by controls)
    container.scrollTo({ top: Math.max(0, blockTop(el, container) - 8), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTick]);

  // Live: pages of the section (split at its text breaks, else balanced when it is long)
  const livePagesOf = (idx: number) => paginateLines(blocks[idx]?.lines ?? []).length;

  const handleNextSection = () => {
    if (displayMode === 'live' && livePage < livePagesOf(currentBlockIndex) - 1) {
      setLivePage(livePage + 1);
    } else if (currentBlockIndex < blocks.length - 1) {
      jumpToBlock(currentBlockIndex + 1);
    }
  };

  const handlePrevSection = () => {
    if (displayMode === 'live' && livePage > 0) {
      setLivePage(livePage - 1);
    } else if (currentBlockIndex > 0) {
      jumpToBlock(currentBlockIndex - 1);
      // Going back into a long section lands on its last page
      if (displayMode === 'live') setLivePage(livePagesOf(currentBlockIndex - 1) - 1);
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
        }

        animFrameRef.current = requestAnimationFrame(scrollLoop);
      };

      animFrameRef.current = requestAnimationFrame(scrollLoop);
    } else {
      // In Live Mode: auto-advance section after estimated duration based on line count and scrollSpeed
      const currentBlock = blocks[currentBlockIndex];
      const lineCount = currentBlock ? paginateLines(currentBlock.lines)[livePage]?.length ?? currentBlock.lines.length : 4;
      const durationMs =
        scrollMode === 'px'
          ? Math.max(3000, ((lineCount * 36) / scrollPx) * 1000)
          : Math.max(1500, (scrollSecs * 1000) / Math.max(1, blocks.length));

      const timer = setTimeout(() => {
        if (livePage < livePagesOf(currentBlockIndex) - 1) {
          setLivePage((p) => p + 1);
        } else if (currentBlockIndex < blocks.length - 1) {
          setCurrentBlockIndex((prev) => prev + 1);
          setLivePage(0);
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
  }, [isScrolling, isPausedByTouch, scrollMode, scrollPx, scrollSecs, displayMode, blocks, currentBlockIndex, livePage]);

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
    setLivePage(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Live: a single scroll gesture (wheel tick or swipe) moves to the adjacent section.
  // If the current section is taller than the screen, it scrolls normally first and only
  // navigates once the edge is reached.
  const liveRef = useRef<HTMLDivElement>(null);
  const liveNavLockUntil = useRef(0);
  const liveTouch = useRef<{ x: number; y: number; atTop: boolean; atBottom: boolean } | null>(null);
  const LIVE_NAV_COOLDOWN_MS = 500; // one gesture = one section (trackpads/inertia emit many wheel events)

  // A section that overflows the screen by only a few px (big text) must not scroll: it counts as fitting,
  // so every gesture changes section instead of nudging the content.
  const LIVE_OVERFLOW_TOLERANCE_PX = 96;
  const liveFits = (c: HTMLElement) => c.scrollHeight - c.clientHeight <= LIVE_OVERFLOW_TOLERANCE_PX;

  const liveEdges = () => {
    const c = liveRef.current;
    if (!c || liveFits(c)) return { atTop: true, atBottom: true };
    return { atTop: c.scrollTop <= 2, atBottom: c.scrollTop + c.clientHeight >= c.scrollHeight - 2 };
  };

  // Lock scrolling when the section fits (re-checked whenever the text or the layout changes)
  useEffect(() => {
    const c = liveRef.current;
    if (displayMode !== 'live' || !c) return;
    const update = () => {
      const fits = liveFits(c);
      c.style.overflowY = fits ? 'hidden' : '';
      if (fits) c.scrollTop = 0;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    Array.from(c.children).forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      c.style.overflowY = ''; // never leave the Live lock behind (Full must scroll)
    };
  }, [displayMode, currentBlockIndex, livePage, fontSize, panel]);

  const liveGo = (direction: 1 | -1) => {
    const now = Date.now();
    if (now < liveNavLockUntil.current) return;
    liveNavLockUntil.current = now + LIVE_NAV_COOLDOWN_MS;
    if (direction === 1) handleNextSection();
    else handlePrevSection();
  };

  const handleLiveWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 8 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const { atTop, atBottom } = liveEdges();
    if (e.deltaY > 0 && atBottom) liveGo(1);
    else if (e.deltaY < 0 && atTop) liveGo(-1);
  };

  const handleLiveTouchStart = (e: React.TouchEvent) => {
    handleTouchStart();
    const t = e.touches[0];
    liveTouch.current = { x: t.clientX, y: t.clientY, ...liveEdges() };
  };

  const handleLiveTouchEnd = (e: React.TouchEvent) => {
    handleTouchEnd();
    const start = liveTouch.current;
    liveTouch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = start.y - t.clientY; // > 0: finger moved up (content scrolls down)
    const dx = start.x - t.clientX;
    if (Math.abs(dy) < 45 || Math.abs(dy) < Math.abs(dx)) return;
    if (dy > 0 && start.atBottom) liveGo(1);
    else if (dy < 0 && start.atTop) liveGo(-1);
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
  const livePageCount = livePagesOf(currentBlockIndex);
  // Position inside a run of consecutive same-name sections ("repetición 1/2")
  const repeatPos = sectionMarks[currentBlockIndex]?.repeat ?? 1;
  let repeatTotal = repeatPos;
  while (sectionMarks[currentBlockIndex + (repeatTotal - repeatPos) + 1]?.repeat === repeatTotal + 1) repeatTotal++;
  const livePages = paginateLines(currentBlock.lines);

  const AMBER = 'bg-[oklch(0.82_0.14_75)] text-[#17130a]';
  // "Resaltar coro": chorus sections get an amber bar and tint (the rest of the text stays untouched)
  const CHORUS_HIGHLIGHT =
    'rounded-[20px] border-l-[4px] border-[oklch(0.82_0.14_75)] bg-[oklch(0.82_0.14_75_/_0.16)] shadow-[inset_0_0_0_1px_oklch(0.82_0.14_75_/_0.18)]';
  // Live: same outline as Full but with a more translucent fill (0.07 vs 0.16), since the section is already centered on screen
  const CHORUS_HIGHLIGHT_LIVE =
    'rounded-[20px] border-l-[4px] border-[oklch(0.82_0.14_75)] bg-[oklch(0.82_0.14_75_/_0.07)] shadow-[inset_0_0_0_1px_oklch(0.82_0.14_75_/_0.18)]';
  const GLASS = 'bg-white/[0.07] border border-white/[0.14] backdrop-blur-xl';
  const DOCK = 'bg-[color:var(--dock)] border border-white/[0.16] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)]';
  const isLive = displayMode === 'live';

  useEffect(() => {
    document.documentElement.classList.toggle('live-mode', isLive);
    return () => document.documentElement.classList.remove('live-mode');
  }, [isLive]);
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
      {pinDialog}

      <ConfirmDialog
        open={shareOpen}
        icon={<Share2 className="w-6 h-6" />}
        title="Compartir canción"
        message={`"${song.title}" con todas sus secciones, en texto.`}
        onClose={() => setShareOpen(false)}
        actions={[
          {
            label: hasSystemShare() ? 'Compartir…' : 'Compartir por WhatsApp',
            tone: 'primary',
            onClick: () => {
              setShareOpen(false);
              shareSong(song);
            },
          },
          {
            label: 'Copiar texto',
            tone: 'neutral',
            onClick: async () => {
              setShareOpen(false);
              showShareToast((await copySongText(song)) ? 'Letra copiada ✓' : 'No se pudo copiar');
            },
          },
          { label: 'Cancelar', tone: 'neutral', onClick: () => setShareOpen(false) },
        ]}
      />

      {shareToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-full bg-zinc-900/90 border border-white/20 backdrop-blur-xl text-[13px] font-bold shadow-xl">
          {shareToast}
        </div>
      )}
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
        {/* Equal side columns keep the title centered regardless of how many buttons sit on each side */}
        <div className="grid grid-cols-[80px_minmax(0,1fr)_80px] items-center gap-2 px-4 shrink-0 pt-4">
          <button
            onClick={onBack}
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 hover:bg-white/15 ${GLASS}`}
            title="Volver"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 text-center">
            <div className={`text-[15px] leading-tight font-extrabold truncate`}>{song.title}</div>
            <div className={`text-xs leading-tight opacity-60 truncate`}>{song.artist}</div>
          </div>
          <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setShareOpen(true)}
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 hover:bg-white/15 ${GLASS}`}
            title="Compartir"
            aria-label="Compartir"
          >
            <Share2 className="w-[17px] h-[17px]" />
          </button>
          <button
            onClick={handleToggleFav}
            className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 hover:bg-white/15 ${GLASS} ${
              isFav ? 'text-[oklch(0.75_0.17_10)]' : ''
            }`}
            title="Favorito"
          >
            <Heart className={`w-[18px] h-[18px] ${isFav ? 'fill-current' : ''}`} />
            {burst && <FavBurst key={burst.n} text={burst.text} />}
          </button>
          </div>
        </div>

        {/* Mode switch */}
        <div className={`flex justify-center shrink-0 pt-2`}>
          <div className={`flex rounded-full p-0.5 ${GLASS}`}>
            <button
              onClick={() => setDisplayMode('standard')}
              className={`px-3.5 py-1 text-[11px] rounded-full font-extrabold transition-all ${
                !isLive ? AMBER : ''
              }`}
            >
              Full
            </button>
            <button
              onClick={() => setDisplayMode('live')}
              className={`px-3.5 py-1 text-[11px] rounded-full font-extrabold transition-all ${
                isLive ? AMBER : ''
              }`}
            >
              Live
            </button>
          </div>
        </div>

        {/* Section chips: tap to jump; in Full the active one follows the scroll position */}
        {sectionMarks.length > 0 && (
          <div ref={chipsRef} className={`flex gap-2.5 px-4 pr-5 overflow-x-auto no-scrollbar shrink-0 pt-3`}>
            {sectionMarks.filter((sec) => sec.repeat === 1).map((sec, sIdx) => {
              // Repeated sections (same name, consecutive) collapse into this one chip
              let count = 1;
              while (sectionMarks[sec.blockIndex + count]?.repeat === count + 1) count++;
              const isCurrent = currentBlockIndex >= sec.blockIndex && currentBlockIndex < sec.blockIndex + count;
              return (
                <div key={sIdx} className="relative shrink-0">
                  <button
                    data-chip={sec.blockIndex}
                    onClick={() => jumpToBlock(sec.blockIndex)}
                    title={sec.label}
                    className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      isCurrent
                        ? 'bg-[oklch(0.82_0.14_75)] text-[#17130a] border-[oklch(0.82_0.14_75)]'
                        : 'bg-white/[0.07] border-white/[0.12]'
                    }`}
                  >
                    {compactSectionLabel(sec.label)}
                  </button>
                  {count > 1 && (
                    <span className="pointer-events-none absolute -top-2 -right-1.5 min-w-[18px] h-[16px] px-1 rounded-full repeat-badge border text-[9px] font-extrabold leading-none flex items-center justify-center">
                      x{count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Lyrics */}
        {isLive ? (
          <div
            key="live"
            ref={liveRef}
            className="flex-1 flex flex-col justify-center gap-[18px] px-5 pb-24 overflow-y-auto overscroll-y-contain no-scrollbar"
            onWheel={handleLiveWheel}
            onTouchStart={handleLiveTouchStart}
            onTouchEnd={handleLiveTouchEnd}
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
              className={`${textStyleClasses} ${slideClass} ${
                highlightChorus && currentBlock.sectionType === 'chorus' ? `${CHORUS_HIGHLIGHT_LIVE} -mx-3 px-3 py-3` : ''
              }`}
            >
              <div className="flex items-center justify-between mb-4 pr-1 text-[11px] font-extrabold tracking-[0.14em] uppercase text-[oklch(0.85_0.13_75)]">
                <span className="flex items-center gap-2.5">
                  {currentBlock.sectionLabel}
                  {livePageCount > 1 && (
                    <span className="flex items-center gap-1" role="img" aria-label={`Página ${livePage + 1} de ${livePageCount}`}>
                      {Array.from({ length: livePageCount }, (_, i) => (
                        <span
                          key={i}
                          className={`rounded-full transition-all ${
                            i === livePage ? 'w-2 h-2 bg-[oklch(0.82_0.14_75)]' : 'w-1.5 h-1.5 bg-current opacity-35'
                          }`}
                        />
                      ))}
                    </span>
                  )}
                </span>
                {repeatTotal > 1 && (
                  <span className="px-1.5 py-0 leading-[14px] rounded-full border border-[oklch(0.82_0.14_75_/_0.5)] bg-[oklch(0.82_0.14_75_/_0.12)] text-[10px] tracking-normal whitespace-nowrap">
                    repetición {repeatPos}/{repeatTotal}
                  </span>
                )}
              </div>
              {/* All pages share one grid cell, so the block is as tall as the tallest page and the
                  header (title, dots, repetition) never moves when the page changes */}
              <div className={`grid ${align === 'center' ? 'px-12' : 'pr-12'}`}>
                {livePages.map((page, p) => (
                  <div
                    key={p}
                    style={{ gridArea: '1 / 1' }}
                    className={p === livePage ? pageSlideClass : 'invisible'}
                    aria-hidden={p === livePage ? undefined : true}
                  >
                    {page.map((line, i) => (
                      <div
                        key={i}
                        className="font-extrabold tracking-tight mt-1.5 leading-[1.28]"
                        style={{ fontSize: `${fontSize + 9}px` }}
                      >
                        {line}
                      </div>
                    ))}
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
            key="full"
            ref={scrollContainerRef}
            onScroll={syncSectionWithScroll}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-28 scroll-smooth focus:outline-none [mask-image:linear-gradient(transparent,#000_14px,#000_calc(100%-100px),transparent)]"
          >
            <div className={`flex flex-col gap-7 ${textStyleClasses}`} style={{ fontSize: `${fontSize}px` }}>
              {blocks.map((block, index) => {
                const isChorus = highlightChorus && block.sectionType === 'chorus';
                return (
                <div
                  key={block.id || index}
                  ref={(el) => {
                    if (el) blockRefs.current.set(index, el);
                  }}
                  className={isChorus ? `${CHORUS_HIGHLIGHT} -mx-3 px-3 py-3` : ''}
                >
                  <div className="text-[11px] font-extrabold tracking-[0.14em] uppercase mb-2 text-[oklch(0.85_0.13_75)]">
                    {block.sectionLabel}                  </div>
                  {block.lines.map((line, lIdx) => (
                    <div key={lIdx} className={`leading-[1.45] tracking-tight ${isChorus ? 'font-bold' : 'font-semibold'} ${line ? '' : 'h-3'}`}>
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

        {/* Floating section navigation (outside the dock). Live only: Full navigates by scrolling */}
        {isLive && (
        <div
          ref={navRef}
          onPointerDown={handleNavPointerDown}
          onPointerMove={handleNavPointerMove}
          onPointerUp={endNavPress}
          onPointerCancel={endNavPress}
          onContextMenu={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            if (navJustDragged.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          style={{
            transform: `translate(${navDx}px, ${navDy}px) scale(${navHeld ? 1.08 : 1})`,
            bottom: `min(${NAV_BOTTOM_PX + navLift}px, calc(100% - ${NAV_TOP_LIMIT_PX + 110}px))`,
          }}
          className={`absolute ${navSide === 'left' ? 'left-3.5' : 'right-3.5'} z-10 flex flex-col gap-1.5 p-1.5 rounded-full touch-none select-none ${DOCK} ring-1 ${
            navHeld ? 'ring-2 ring-[oklch(0.82_0.14_75)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]' : 'ring-[oklch(0.82_0.14_75_/_0.45)]'
          } transition-[opacity,translate] duration-200 ${
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
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 ${AMBER} shadow-[0_6px_18px_oklch(0.72_0.15_70_/_0.45)] disabled:opacity-30 disabled:shadow-none disabled:grayscale`}
            >
              <Icon className={'w-6 h-6'} strokeWidth={3.2} />
            </button>
          ))}
        </div>
        )}

        {/* Option panels (one per dock button) */}
        {panel && (
          <div
            key={panel}
            ref={panelRef}
            className={`absolute left-3.5 right-3.5 bottom-[84px] z-20 p-[18px] rounded-[28px] bg-[color:var(--sheet)] border border-white/[0.18] backdrop-blur-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col gap-3.5 max-h-[55%] overflow-y-auto no-scrollbar animate-[sheetIn_0.22s_cubic-bezier(0.2,0.9,0.3,1)]`}
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
          className={`absolute left-3.5 right-3.5 bottom-3 h-[58px] rounded-full px-3 z-10 grid grid-cols-[1fr_auto_1fr] items-center ${DOCK}`}
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
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[15px] font-extrabold transition-all duration-150 active:scale-90 ${
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
            className={`mx-1 w-11 h-11 rounded-full flex items-center justify-center shadow-[0_8px_28px_oklch(0.72_0.15_70_/_0.5)] active:scale-95 transition-transform ${AMBER}`}
            title={isScrolling ? 'Pausar auto-avance' : 'Auto-avance'}
          >
            {isScrolling ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
          </button>

          <div className="flex items-center justify-evenly">
            <button
              onClick={() => togglePanel('speed')}
              title="Velocidad del scroll"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 ${
                panel === 'speed' ? `${AMBER} animate-[pop_0.28s_ease-out]` : 'bg-white/[0.09]'
              }`}
            >
              <Gauge className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => guard(() => onEdit(song, currentBlockIndex))}
              className={`w-8 h-8 rounded-full bg-white/[0.09] flex items-center justify-center active:scale-90 transition-transform`}
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
