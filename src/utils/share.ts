import { Song } from '../types/song';
import { parseLyricsToBlocks } from './lyricsParser';

/** Plain-text version of a song for messaging apps: title, artist and every section under its label (*bold* in WhatsApp). */
export function formatSongForShare(song: Pick<Song, 'title' | 'artist' | 'lyrics'>): string {
  const header = [`*${song.title}*`, song.artist].filter(Boolean).join('\n');
  const body = parseLyricsToBlocks(song.lyrics)
    .map((block) => `*${block.sectionLabel}*\n${block.lines.join('\n')}`)
    .join('\n\n');
  return `${header}\n\n${body}`;
}

/** Opens WhatsApp (app or web) with the song text ready to send; the user picks the chat. */
export function shareSongOnWhatsApp(song: Pick<Song, 'title' | 'artist' | 'lyrics'>) {
  const url = `https://wa.me/?text=${encodeURIComponent(formatSongForShare(song))}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
