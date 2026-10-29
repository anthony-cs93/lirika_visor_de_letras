import React from 'react';

/**
 * Subtle message that appears above a heart button and fades upward.
 * Render it inside a `relative` parent; remount it (new `key`) to replay the animation.
 */
export function FavBurst({ text }: { text: string }) {
  return (
    <span
      aria-live="polite"
      className="pointer-events-none absolute right-0 bottom-full mb-0.5 z-30 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold leading-none text-[color:var(--ink)] bg-[color:var(--sheet)] border border-white/15 backdrop-blur-xl shadow-lg animate-[floatUp_1.5s_ease-out_forwards]"
    >
      {text}
    </span>
  );
}
