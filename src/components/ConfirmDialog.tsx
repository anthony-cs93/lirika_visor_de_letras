import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

export interface DialogAction {
  label: string;
  tone?: 'primary' | 'danger' | 'neutral';
  onClick: () => void;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  icon?: React.ReactNode;
  /** Visual tone of the icon bubble. */
  tone?: 'primary' | 'danger';
  /** Buttons, in reading order. Two actions render side by side, three or more stacked. */
  actions: DialogAction[];
  /** Backdrop click / Escape. */
  onClose: () => void;
}

const TONE_BUTTON: Record<NonNullable<DialogAction['tone']>, string> = {
  primary: 'bg-[oklch(0.82_0.14_75)] text-[#17130a] shadow-[0_8px_24px_oklch(0.72_0.15_70_/_0.35)]',
  danger: 'bg-[oklch(0.62_0.21_22)] text-white shadow-[0_8px_24px_oklch(0.55_0.2_22_/_0.35)]',
  neutral: 'bg-white/10 text-[color:var(--ink)]',
};

const TONE_ICON: Record<NonNullable<ConfirmDialogProps['tone']>, string> = {
  primary: 'bg-[oklch(0.82_0.14_75_/_0.18)] text-[oklch(0.82_0.14_75)]',
  danger: 'bg-[oklch(0.62_0.21_22_/_0.18)] text-[oklch(0.7_0.19_22)]',
};

/**
 * Glass confirmation dialog shared by every "are you sure?" / notice in the app.
 * Rendered in a portal so it is never clipped by (or positioned inside) a blurred parent.
 */
export function ConfirmDialog({ open, title, message, icon, tone = 'primary', actions, onClose }: ConfirmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const stacked = actions.length > 2;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4 bg-black/55 backdrop-blur-md animate-[fadeIn_0.18s_ease-out]"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[32px] p-6 text-[color:var(--ink)] bg-[color:var(--sheet)] border border-white/[0.18] backdrop-blur-3xl shadow-[0_24px_70px_rgba(0,0,0,0.5)] animate-[sheetIn_0.24s_cubic-bezier(0.2,0.9,0.3,1)]"
      >
        <div className="flex flex-col items-center text-center gap-3">
          {icon && (
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${TONE_ICON[tone]}`}>{icon}</div>
          )}
          <h3 id={titleId} className="text-[18px] font-extrabold tracking-tight leading-snug">
            {title}
          </h3>
          {message && <p className="text-[13px] leading-relaxed opacity-70">{message}</p>}
        </div>

        <div className={`mt-6 gap-2.5 ${
          stacked ? 'flex flex-col' : actions.length === 1 ? 'grid grid-cols-1' : 'grid grid-cols-2'
        }`}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={`h-12 px-4 rounded-full text-sm font-extrabold active:scale-95 transition-transform ${
                TONE_BUTTON[a.tone ?? 'neutral']
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
