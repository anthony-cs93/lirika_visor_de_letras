import { ThemeMode, FontFamily, LineHeight, TextAlign, TextTransform } from '../types/song';

export interface ThemeStyles {
  id: ThemeMode;
  name: string;
  tagline: string;
  badge: string;
  bgClass: string;
  textClass: string;
  sectionClass: string;
  chorusAccentClass: string;
  cardClass: string;
  borderClass: string;
  metaTextClass: string;
  activeLineBg: string;
  selectedSectionShadow: string;
  liveGradient: string;
  liveActiveText: string;
  buttonClass: string;
}

export const THEMES: Record<ThemeMode, ThemeStyles> = {
  dark: {
    id: 'dark',
    name: 'Modo Noche (OLED)',
    tagline: 'Lectura nocturna relajada y anti-fatiga visual',
    badge: 'Nocturno',
    bgClass: 'bg-zinc-950 text-zinc-100',
    textClass: 'text-zinc-100',
    sectionClass: 'text-amber-400 bg-amber-950/40 border-amber-900/60 font-semibold',
    chorusAccentClass: 'text-amber-200 bg-zinc-900/60 border-l-2 border-amber-400 pl-3',
    cardClass: 'bg-zinc-900/90 border-zinc-800 text-zinc-100',
    borderClass: 'border-zinc-800',
    metaTextClass: 'text-zinc-400',
    activeLineBg: 'bg-zinc-800/80',
    selectedSectionShadow: 'shadow-[0_10px_35px_-5px_rgba(251,191,36,0.18)] ring-1 ring-amber-400/50 bg-zinc-900/95',
    liveGradient: 'from-[#2e083a] via-[#170523] to-[#0a0210]',
    liveActiveText: 'text-white font-extrabold drop-shadow-md',
    buttonClass: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700',
  },
  light: {
    id: 'light',
    name: 'Modo Papel Minimalista',
    tagline: 'Tono marfil cálido, tipografía editorial tipo cancionero',
    badge: 'Papel',
    bgClass: 'bg-[#faf8f5] text-stone-900',
    textClass: 'text-stone-900',
    sectionClass: 'text-stone-700 bg-stone-200/80 border-stone-300 font-semibold',
    chorusAccentClass: 'text-stone-900 bg-stone-200/40 border-l-2 border-stone-700 pl-3',
    cardClass: 'bg-[#f4efe6] border-stone-300/80 text-stone-900',
    borderClass: 'border-stone-300',
    metaTextClass: 'text-stone-600',
    activeLineBg: 'bg-amber-100/70',
    selectedSectionShadow: 'shadow-[0_10px_35px_-5px_rgba(40,30,20,0.18)] ring-1 ring-stone-400/80 bg-white/95',
    liveGradient: 'from-[#fef3c7]/60 via-[#f4efe6] to-[#e7dfd1]',
    liveActiveText: 'text-stone-950 font-black',
    buttonClass: 'bg-[#ebe5d8] hover:bg-[#ded6c5] text-stone-900 border border-stone-300',
  },
  stage: {
    id: 'stage',
    name: 'Modo Escenario (Alto Contraste)',
    tagline: 'Azul medianoche y acentos neón para ensayos y directos',
    badge: 'Escenario',
    bgClass: 'bg-[#080d1a] text-white',
    textClass: 'text-white',
    sectionClass: 'text-cyan-300 bg-cyan-950/70 border-cyan-500/60 font-bold',
    chorusAccentClass: 'text-cyan-100 bg-cyan-950/40 border-l-2 border-cyan-400 pl-3',
    cardClass: 'bg-[#0f172a] border-cyan-900/60 text-white',
    borderClass: 'border-cyan-950',
    metaTextClass: 'text-cyan-200/70',
    activeLineBg: 'bg-cyan-950/80 border-l-2 border-cyan-400',
    selectedSectionShadow: 'shadow-[0_10px_35px_-5px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400/70 bg-[#0f172a]',
    liveGradient: 'from-[#082f49] via-[#0b1329] to-[#030712]',
    liveActiveText: 'text-cyan-50 font-black drop-shadow-lg',
    buttonClass: 'bg-slate-800 hover:bg-slate-700 text-white border border-cyan-800/50',
  },
};

export function getFontFamilyClass(family: FontFamily): string {
  switch (family) {
    case 'serif':
      return 'font-serif';
    case 'mono':
      return 'font-mono';
    case 'condensed':
      return 'tracking-tight font-sans font-medium';
    case 'sans':
    default:
      return 'font-sans';
  }
}

export function getLineHeightClass(lh: LineHeight): string {
  switch (lh) {
    case 'compact':
      return 'leading-relaxed';
    case 'relaxed':
      return 'leading-loose';
    case 'normal':
    default:
      return 'leading-8';
  }
}

export function getTextAlignClass(align: TextAlign): string {
  switch (align) {
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    case 'left':
    default:
      return 'text-left';
  }
}

export function getTextTransformClass(transform: TextTransform): string {
  switch (transform) {
    case 'uppercase':
      return 'uppercase tracking-wider';
    case 'capitalize':
      return 'capitalize';
    case 'none':
    default:
      return '';
  }
}
