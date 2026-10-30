import { SongBlock, SectionType, SectionMark } from '../types/song';

export const SECTION_DEFINITIONS: { type: SectionType; label: string; badge: string }[] = [
  { type: 'intro', label: 'Intro', badge: 'Intro' },
  { type: 'verse', label: 'Verso', badge: 'Verso' },
  { type: 'prechorus', label: 'Pre-Coro', badge: 'Pre-Coro' },
  { type: 'chorus', label: 'Coro', badge: 'Coro' },
  { type: 'repeat', label: 'Repetición', badge: 'Rp' },
  { type: 'bridge', label: 'Puente', badge: 'Puente' },
  { type: 'interlude', label: 'Interludio', badge: 'Interludio' },
  { type: 'solo', label: 'Instrumental', badge: 'Solo' },
  { type: 'outro', label: 'Outro', badge: 'Final' },
  // Wildcard: the visible name is free text and the badge shows its first letters
  { type: 'custom', label: 'Otro', badge: 'Otro' },
];

/**
 * Removes any musical chord brackets [C], [Am7], [G#m/B] or standalone chord lines
 * because this app is purely for lyrics.
 */
export function stripChords(text: string): string {
  // Remove bracketed chords like [C], [Am], [F#m], [Bb7]
  let cleaned = text.replace(/\[[A-G][b#]?(?:m|maj|min|dim|aug|sus[24]?|[0-9]{1,2}|add[0-9]|M[0-9]?)?(?:\/[A-G][b#]?)?\]/g, '');

  // Remove lines that are purely musical chords (e.g., "C   G   Am   F")
  const lines = cleaned.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    // Don't filter section headers like [Coro] or [Verso 1]
    if (/^\[?(intro|interludio|verso|verse|coro|chorus|estribillo|pre-?coro|pre-?chorus|repetici[oó]n|puente|bridge|solo|outro|final)/i.test(trimmed)) {
      return true;
    }
    const words = trimmed.split(/\s+/);
    const isOnlyChords = words.length > 0 && words.every((w) =>
      /^[A-G][b#]?(?:m|maj|min|dim|aug|sus[24]?|[0-9]{1,2}|add[0-9]|M[0-9]?)?(?:\/[A-G][b#]?)?$/.test(w)
    );
    return !isOnlyChords;
  });

  return filtered.join('\n');
}

/**
 * Strips LRC timestamp headers like [01:23.45]
 */
export function cleanLrcContent(content: string): string {
  let cleaned = stripChords(content)
    .replace(/^\[ti:.*\]\r?\n?/gim, '')
    .replace(/^\[ar:.*\]\r?\n?/gim, '')
    .replace(/^\[al:.*\]\r?\n?/gim, '')
    .replace(/^\[by:.*\]\r?\n?/gim, '')
    .replace(/^\[offset:.*\]\r?\n?/gim, '')
    .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '')
    .trim();
  return cleaned;
}

/**
 * Detects section type from label
 */
export function detectSectionType(raw: string): { type: SectionType; cleanLabel: string } {
  const trimmed = raw.replace(/^\[+|\]+$/g, '').trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('intro')) return { type: 'intro', cleanLabel: 'Intro' };
  if (lower.startsWith('repetici') || lower.startsWith('repeat')) {
    return { type: 'repeat', cleanLabel: trimmed || 'Repetición' };
  }
  if (lower.startsWith('pre-coro') || lower.startsWith('precoro') || lower.startsWith('pre-chorus')) {
    return { type: 'prechorus', cleanLabel: trimmed || 'Pre-Coro' };
  }
  if (lower.startsWith('coro') || lower.startsWith('chorus') || lower.startsWith('estribillo')) {
    return { type: 'chorus', cleanLabel: trimmed || 'Coro' };
  }
  if (lower.startsWith('puente') || lower.startsWith('bridge')) {
    return { type: 'bridge', cleanLabel: trimmed || 'Puente' };
  }
  if (lower.startsWith('interludio')) {
    return { type: 'interlude', cleanLabel: trimmed || 'Interludio' };
  }
  if (lower.startsWith('solo') || lower.startsWith('instrumental')) {
    return { type: 'solo', cleanLabel: 'Instrumental' };
  }
  if (lower.startsWith('outro') || lower.startsWith('final')) {
    return { type: 'outro', cleanLabel: 'Outro' };
  }
  if (lower.startsWith('verso') || lower.startsWith('verse')) {
    return { type: 'verse', cleanLabel: trimmed || 'Verso' };
  }

  return { type: 'custom', cleanLabel: trimmed };
}

/**
 * Parses raw song text into discrete blocks/stanzas.
 * Each section is separated by empty lines (un salto arriba y abajo).
 */
export function parseLyricsToBlocks(lyrics: string): SongBlock[] {
  const cleaned = stripChords(lyrics);
  // Split on double or multiple newlines
  const rawParagraphs = cleaned.split(/\n\s*\n+/);
  const blocks: SongBlock[] = [];
  let verseCounter = 1;

  rawParagraphs.forEach((para, pIdx) => {
    const rawLines = para.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (rawLines.length === 0) return;

    let sectionType: SectionType = 'verse';
    let sectionLabel = `Verso ${verseCounter}`;
    let contentLines = [...rawLines];

    // Check if the first line is a section header like [Coro] or [Verso 1] or Coro:
    const firstLine = rawLines[0];
    const sectionMatch = firstLine.match(
      /^\s*\[?(Intro|Interludio|Verso|Verse|Coro|Chorus|Estribillo|Pre-?coro|Pre-?chorus|Repetici[oó]n|Repeat|Puente|Bridge|Solo|Instrumental|Outro|Final)[^\]:]*\]?:?\s*$/i
    );
    // Any other fully bracketed first line, e.g. [Rap] or [Ministración], is a custom section header
    const customMatch = !sectionMatch && rawLines.length > 1 ? firstLine.match(/^\s*\[([^\]]{1,40})\]\s*$/) : null;

    if (sectionMatch || customMatch) {
      const detected = detectSectionType(firstLine);
      sectionType = detected.type;
      sectionLabel = detected.cleanLabel;
      // Content lines are the rest of the lines in this block
      contentLines = rawLines.slice(1);
    } else {
      // Default to Verso X
      sectionType = 'verse';
      sectionLabel = `Verso ${verseCounter}`;
      verseCounter++;
    }

    // Only add if there are lines or it's an instrumental/solo section
    if (contentLines.length > 0 || sectionType === 'solo') {
      blocks.push({
        id: `block_${pIdx}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sectionType,
        sectionLabel,
        lines: contentLines.length > 0 ? contentLines : ['(Instrumental)'],
      });
    }
  });

  return blocks;
}

/**
 * Converts structured SongBlock[] back into full lyrics text
 * guaranteeing clean empty lines (salto arriba y abajo) between every section.
 */
export function blocksToLyrics(blocks: SongBlock[]): string {
  return blocks
    .map((b) => {
      const header = `[${b.sectionLabel || 'Verso'}]`;
      const body = b.lines.filter((l) => l.trim().length > 0).join('\n');
      return `${header}\n${body}`;
    })
    .join('\n\n');
}

/**
 * Extracts section marks for navigation
 */
export function getSectionMarks(blocks: SongBlock[]): SectionMark[] {
  return blocks.map((b, idx) => ({
    index: idx,
    blockIndex: idx,
    label: b.sectionLabel,
    type: b.sectionType,
  }));
}

/** Numbered variants offered by the section picker in the editor. */
export const SECTION_VARIANTS: Partial<Record<SectionType, { name: string; short: string; count: number }>> = {
  verse: { name: 'Verso', short: 'V', count: 4 },
  prechorus: { name: 'Pre-Coro', short: 'Pr', count: 2 },
  chorus: { name: 'Coro', short: 'C', count: 2 },
  bridge: { name: 'Puente', short: 'P', count: 2 },
};

const COMPACT_PREFIX: Record<SectionType, string> = {
  intro: 'I',
  interlude: 'In',
  verse: 'V',
  prechorus: 'Pr',
  chorus: 'C',
  repeat: 'Rp',
  bridge: 'P',
  solo: 'S',
  outro: 'O',
  custom: '',
};

/**
 * Short badge for a section label: "Verso 1" -> "V1", "Coro" -> "C", "Pre-Coro 2" -> "PC2".
 * The full label is still what is stored and shown in the editor.
 */
export function compactSectionLabel(label: string): string {
  const { type } = detectSectionType(label);
  const num = label.trim().match(/(\d+)\s*$/)?.[1] ?? '';
  const prefix = COMPACT_PREFIX[type];
  if (prefix) return prefix + num;
  // Free-text names: first 3 letters, first one capitalized ("ministración" -> "Min", "Rap" -> "Rap")
  const t = label.trim();
  if (t.toLowerCase() === 'otro') return 'Otro';
  return t.charAt(0).toUpperCase() + t.slice(1, 3);
}
