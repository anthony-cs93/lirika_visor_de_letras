// Reference links of a song: one per music platform.
import { PLATFORM_ICONS } from './platformIcons';

export type LinkPlatform = 'youtube' | 'spotify' | 'appleMusic' | 'soundcloud';
export type SongLinks = Partial<Record<LinkPlatform, string>>;

export const LINK_PLATFORMS: {
  key: LinkPlatform;
  label: string;
  hosts: string[]; // accepted domains (and their subdomains)
  color: string; // official brand colour of the glyph
}[] = [
  { key: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], color: PLATFORM_ICONS.youtube.color },
  { key: 'spotify', label: 'Spotify', hosts: ['spotify.com', 'spotify.link'], color: PLATFORM_ICONS.spotify.color },
  { key: 'appleMusic', label: 'Apple Music', hosts: ['music.apple.com', 'itunes.apple.com'], color: PLATFORM_ICONS.appleMusic.color },
  { key: 'soundcloud', label: 'SoundCloud', hosts: ['soundcloud.com', 'on.soundcloud.com'], color: PLATFORM_ICONS.soundcloud.color },
];

/** Only http(s) links are ever rendered or stored (never javascript:, data:, ...). */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const hostMatches = (host: string, hosts: string[]) => hosts.some((h) => host === h || host.endsWith(`.${h}`));

/** Checks a pasted link for one platform. Returns the cleaned link or an error message. */
export function checkLink(platform: LinkPlatform, raw: string): { url: string } | { error: string } {
  const def = LINK_PLATFORMS.find((p) => p.key === platform)!;
  const url = safeUrl(raw);
  if (!url) return { error: `El enlace de ${def.label} no es válido` };
  const host = new URL(url).hostname.toLowerCase();
  if (!hostMatches(host, def.hosts)) return { error: `Ese enlace no parece ser de ${def.label}` };
  return { url };
}

/** Links that can be shown: known platform, valid address. */
export function visibleLinks(links: SongLinks | undefined) {
  if (!links) return [];
  return LINK_PLATFORMS.flatMap((p) => {
    const url = safeUrl(links[p.key]);
    return url ? [{ ...p, url }] : [];
  });
}
