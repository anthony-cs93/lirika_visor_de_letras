import { Song } from '../types/song';
import { parseLyricsToBlocks } from './lyricsParser';

type Shareable = Pick<Song, 'title' | 'artist' | 'lyrics'>;

/** Plain-text version of a song for messaging apps: title, artist and every section under its label (*bold* in WhatsApp). */
export function formatSongForShare(song: Shareable): string {
  const header = [`*${song.title}*`, song.artist].filter(Boolean).join('\n');
  const body = parseLyricsToBlocks(song.lyrics)
    .map((block) => `*${block.sectionLabel}*\n${block.lines.join('\n')}`)
    .join('\n\n');
  return `${header}\n\n${body}`;
}

/** True when the browser offers the native share sheet (mobile browsers, some desktop ones). */
export const hasSystemShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

const openWhatsApp = (text: string) =>
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');

/**
 * Shares the song as text. With the native share sheet the user picks the app (WhatsApp, WhatsApp Business, ...);
 * without it (most desktop browsers) it opens WhatsApp Web with the text ready.
 */
export async function shareSong(song: Shareable): Promise<void> {
  const text = formatSongForShare(song);
  if (hasSystemShare()) {
    try {
      await navigator.share({ text });
    } catch (err: any) {
      if (err?.name !== 'AbortError') openWhatsApp(text); // the user closing the sheet is not an error
    }
    return;
  }
  openWhatsApp(text);
}

/** Copies the song text to the clipboard. Resolves to whether it worked. */
export async function copySongText(song: Shareable): Promise<boolean> {
  const text = formatSongForShare(song);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (insecure context, denied permission): legacy fallback
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(area);
    }
  }
}
