import React from 'react';
import { PLATFORM_ICONS } from '../utils/platformIcons';
import type { LinkPlatform } from '../utils/links';

/** The platform's official glyph, in its brand colour unless a colour is given. */
export function PlatformIcon({ platform, size = 16, color }: { platform: LinkPlatform; size?: number; color?: string }) {
  const icon = PLATFORM_ICONS[platform];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color ?? icon.color} aria-hidden="true" focusable="false">
      <path d={icon.path} />
    </svg>
  );
}
