import React from 'react';
import { ArrowLeft, Check } from 'lucide-react';

export const CARD = 'rounded-3xl bg-white/[0.06] border border-white/10 backdrop-blur-xl';
export const FIELD =
  'w-full h-11 px-4 rounded-full bg-white/[0.06] border border-white/15 text-sm text-[color:var(--ink)] outline-none focus:border-[oklch(0.82_0.14_75)] transition-colors placeholder:opacity-40';
export const PRIMARY_BTN =
  'h-11 px-5 rounded-full text-xs font-extrabold bg-[oklch(0.82_0.14_75)] text-[#17130a] active:scale-95 transition-transform disabled:opacity-50';
export const SOFT_BTN =
  'h-9 px-3.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5';

interface ScreenShellProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  notice?: string | null;
  error?: string | null;
  children: React.ReactNode;
}

/** Full-screen page used by Cuenta and Administración: round back button, big title, scrolling body. */
export function ScreenShell({ title, subtitle, onBack, notice, error, children }: ScreenShellProps) {
  return (
    <div className="relative flex flex-col h-full bg-[color:var(--page)] text-[color:var(--ink)] overflow-hidden">
      <div className="pointer-events-none absolute -left-28 -top-16 w-[340px] h-[340px] rounded-full opacity-40 blur-[80px] bg-[oklch(0.72_0.15_70)]" />
      <div className="pointer-events-none absolute -right-36 top-[300px] w-[360px] h-[360px] rounded-full opacity-35 blur-[90px] bg-[oklch(0.62_0.17_300)]" />

      <header className="relative z-10 flex items-center gap-3.5 px-5 pt-5 pb-3 shrink-0">
        <button
          onClick={onBack}
          aria-label="Volver"
          className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 transition ${CARD}`}
        >
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="min-w-0">
          <h1 className="text-[26px] leading-none font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs opacity-55 mt-1.5 truncate">{subtitle}</p>}
        </div>
      </header>

      {(notice || error) && (
        <div className="relative z-10 px-5 pb-2">
          <div
            role={error ? 'alert' : 'status'}
            className={`px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
              error
                ? 'bg-[oklch(0.62_0.21_22_/_0.18)] text-[oklch(0.78_0.15_22)]'
                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
            }`}
          >
            {!error && <Check className="w-4 h-4 shrink-0" />}
            <span>{error ?? notice}</span>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-2 pb-10 space-y-6">{children}</div>
    </div>
  );
}

/** Small uppercase label above a group of cards. */
export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 mb-2">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-50">{children}</h2>
      {aside}
    </div>
  );
}

/** Icon tile + label + optional hint, as a row inside a card. Becomes a button when onClick is given. */
export function Row({
  icon,
  label,
  hint,
  right,
  onClick,
  disabled,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  const body = (
    <>
      <span
        className={`w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center bg-white/[0.08] ${
          tone === 'danger' ? 'text-red-400' : 'text-[oklch(0.82_0.14_75)]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold truncate">{label}</span>
        {hint && <span className="block text-[11px] opacity-50 truncate">{hint}</span>}
      </span>
      {right}
    </>
  );
  const cls = 'w-full flex items-center gap-3 px-4 py-3';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${cls} hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Card that stacks rows with hairline dividers. */
export function RowGroup({ children }: { children: React.ReactNode }) {
  return <div className={`${CARD} overflow-hidden divide-y divide-white/10`}>{children}</div>;
}

/** Round initial for a username/email. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full flex items-center justify-center font-extrabold uppercase text-[#17130a] bg-gradient-to-br from-[oklch(0.86_0.13_80)] to-[oklch(0.72_0.16_55)]"
    >
      <span style={{ fontSize: size * 0.42 }}>{name.trim().charAt(0) || '?'}</span>
    </span>
  );
}
