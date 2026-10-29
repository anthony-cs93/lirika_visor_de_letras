import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';

// Protección temporal contra borrados/ediciones accidentales. Cambia el PIN aquí.
const SECURITY_PIN = '2121';
const PIN_LENGTH = SECURITY_PIN.length;
const PIN_TTL_MS = 60_000;

// Vive en memoria del módulo: se comparte entre pantallas y se pierde al recargar.
let unlockedUntil = 0;
const isUnlocked = () => Date.now() < unlockedUntil;

/**
 * Devuelve `guard(action)`: ejecuta la acción al instante si el PIN sigue vigente (1 min),
 * si no, muestra el cuadro de PIN y la ejecuta al acertar. Renderiza `pinDialog` en el JSX.
 */
export function usePinGuard() {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const guard = useCallback((action: () => void) => {
    if (isUnlocked()) {
      action();
      return;
    }
    pending.current = action;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  const onSuccess = useCallback(() => {
    unlockedUntil = Date.now() + PIN_TTL_MS;
    const action = pending.current;
    pending.current = null;
    setOpen(false);
    action?.();
  }, []);

  const pinDialog = <PinDialog open={open} onClose={close} onSuccess={onSuccess} />;
  return { guard, pinDialog };
}

function PinDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(false);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setValue(next);
    setError(false);
    if (next.length === PIN_LENGTH) {
      if (next === SECURITY_PIN) {
        onSuccess();
      } else {
        setError(true);
        setTimeout(() => setValue(''), 350);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4 bg-black/55 backdrop-blur-md animate-[fadeIn_0.18s_ease-out]"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="PIN de seguridad"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[32px] p-6 text-[color:var(--ink)] bg-[color:var(--sheet)] border border-white/[0.18] backdrop-blur-3xl shadow-[0_24px_70px_rgba(0,0,0,0.5)] animate-[sheetIn_0.24s_cubic-bezier(0.2,0.9,0.3,1)]"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[oklch(0.82_0.14_75_/_0.18)] text-[oklch(0.82_0.14_75)]">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-[18px] font-extrabold tracking-tight leading-snug">PIN de seguridad</h3>
          <p className="text-[13px] leading-relaxed opacity-70">
            Ingresa el PIN para editar o eliminar canciones. Se mantendrá activo por 1 minuto.
          </p>
        </div>

        <div className="relative mt-5" onClick={() => inputRef.current?.focus()}>
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_LENGTH}
            aria-label="PIN"
            className="absolute inset-0 w-full h-full opacity-0"
          />
          <div className={`flex justify-center gap-3 ${error ? 'animate-[pop_0.28s_ease-out]' : ''}`}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <div
                key={i}
                className={`w-12 h-14 rounded-2xl flex items-center justify-center text-2xl font-extrabold border transition-colors ${
                  error
                    ? 'border-[oklch(0.62_0.21_22)] bg-[oklch(0.62_0.21_22_/_0.15)]'
                    : i === value.length
                      ? 'border-[oklch(0.82_0.14_75)] bg-white/10'
                      : 'border-white/15 bg-white/[0.06]'
                }`}
              >
                {value[i] ? '•' : ''}
              </div>
            ))}
          </div>
          <p className={`mt-3 text-center text-[12px] font-bold text-[oklch(0.7_0.19_22)] ${error ? '' : 'invisible'}`}>
            PIN incorrecto
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full h-12 px-4 rounded-full text-sm font-extrabold active:scale-95 transition-transform bg-white/10 text-[color:var(--ink)]"
        >
          Cancelar
        </button>
      </div>
    </div>,
    document.body
  );
}
