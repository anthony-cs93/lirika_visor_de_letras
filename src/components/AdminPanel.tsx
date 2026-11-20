import React, { useCallback, useEffect, useState } from 'react';
import { X, ShieldCheck, UserPlus, Trash2, Loader2, KeyRound, Check } from 'lucide-react';
import { AuthUser, Role, EMAIL_MAX, adminApi, isValidEmail, sanitizeEmailInput } from '../utils/auth';
import { ConfirmDialog } from './ConfirmDialog';
import { useAuth } from './AuthGate';

// The shared "Ingresa sin cuenta" account: its password lives in VITE_GUEST_PASSWORD, so it is not changed from here
const GUEST_USERNAME = ((import.meta.env.VITE_GUEST_USERNAME as string | undefined) || '').trim().toLowerCase();

const INPUT =
  'w-full h-10 px-3 rounded-2xl bg-white/[0.06] border border-white/15 text-sm outline-none focus:border-[oklch(0.82_0.14_75)] transition-colors placeholder:opacity-40';

/** Admin-only account management: list, create and delete users. */
export function AdminPanel({ onClose }: { onClose: () => void }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);

  const [passwordTarget, setPasswordTarget] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminApi.list());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await adminApi.create({ username: email, password, role });
      setEmail('');
      setPassword('');
      setRole('user');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const closePasswordDialog = () => {
    setPasswordTarget(null);
    setNewPassword('');
    setPasswordError(null);
  };

  const handleChangePassword = async () => {
    if (!passwordTarget || savingPassword) return;
    if (newPassword.length < 8) return setPasswordError('Mínimo 8 caracteres');
    setSavingPassword(true);
    try {
      await adminApi.update(passwordTarget.id, { password: newPassword });
      setNotice(`Contraseña de ${passwordTarget.username} actualizada`);
      setTimeout(() => setNotice(null), 3000);
      closePasswordDialog();
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDelete = async (target: AuthUser) => {
    setError(null);
    try {
      await adminApi.remove(target.id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <ConfirmDialog
        open={!!deleteTarget}
        tone="danger"
        icon={<Trash2 className="w-6 h-6" />}
        title={deleteTarget ? `¿Eliminar a "${deleteTarget.username}"?` : ''}
        message="La persona ya no podrá iniciar sesión. Esta acción no se puede deshacer."
        onClose={() => setDeleteTarget(null)}
        actions={[
          { label: 'Cancelar', onClick: () => setDeleteTarget(null) },
          {
            label: 'Eliminar',
            tone: 'danger',
            onClick: () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              if (target) handleDelete(target);
            },
          },
        ]}
      />

      <ConfirmDialog
        open={!!passwordTarget}
        icon={<KeyRound className="w-6 h-6" />}
        title={passwordTarget ? `Nueva contraseña para "${passwordTarget.username}"` : ''}
        message={
          <span className="block mt-1">
            <input
              autoFocus
              type="text"
              autoComplete="off"
              maxLength={128}
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
              className="w-full h-11 px-4 rounded-full bg-white/[0.08] border border-white/15 text-sm text-[color:var(--ink)] outline-none focus:border-[oklch(0.82_0.14_75)]"
            />
            <span role="alert" className={`block mt-2 text-xs font-bold text-[oklch(0.7_0.19_22)] ${passwordError ? '' : 'hidden'}`}>
              {passwordError}
            </span>
          </span>
        }
        onClose={closePasswordDialog}
        actions={[
          { label: 'Cancelar', onClick: closePasswordDialog },
          { label: savingPassword ? 'Guardando…' : 'Guardar', tone: 'primary', onClick: handleChangePassword },
        ]}
      />

      <div className="w-full max-w-lg bg-[color:var(--sheet)] backdrop-blur-xl border border-white/10 text-[color:var(--ink)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold">Panel de administración</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 text-zinc-400 hover:text-[color:var(--ink)] rounded-2xl hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {notice && (
            <div className="px-3 py-2 rounded-2xl bg-emerald-950 border border-emerald-900 text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" /> {notice}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="px-3 py-2 rounded-2xl bg-[oklch(0.62_0.21_22_/_0.18)] text-[oklch(0.78_0.15_22)] text-xs font-semibold"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleCreate} className="bg-black/25 p-4 rounded-3xl border border-white/10 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
              <UserPlus className="w-4 h-4 text-amber-400" /> Crear usuario
            </div>
            <input
              className={INPUT}
              type="email"
              inputMode="email"
              maxLength={EMAIL_MAX}
              placeholder="Correo electrónico"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(sanitizeEmailInput(e.target.value))}
            />
            <input
              className={INPUT}
              type="text"
              placeholder="Contraseña (mínimo 8 caracteres)"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <select className={`${INPUT} flex-1`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="user">Usuario</option>
                <option value="admin">Administrador</option>
              </select>
              <button
                type="submit"
                disabled={creating || !isValidEmail(email) || password.length < 8}
                className="h-10 px-5 rounded-full text-xs font-extrabold bg-[oklch(0.82_0.14_75)] text-[#17130a] active:scale-95 transition-transform disabled:opacity-50"
              >
                {creating ? '...' : 'Crear'}
              </button>
            </div>
          </form>

          <GuestSeedSection />

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Usuarios ({users.length})
            </label>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin opacity-60" />
              </div>
            ) : (
              users.map((u) => {
                const isSelf = u.id === me.id;
                const isGuest = !!GUEST_USERNAME && u.username === GUEST_USERNAME;
                return (
                  <div
                    key={u.id}
                    className="p-3 rounded-3xl bg-black/25 border border-white/10 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {u.username}
                        {isSelf && <span className="ml-2 text-[10px] opacity-60">(tú)</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {u.role === 'admin' ? 'Administrador' : 'Usuario'} ·{' '}
                        {u.lastLoginAt
                          ? `último acceso ${new Date(u.lastLoginAt).toLocaleDateString()}`
                          : 'nunca ha entrado'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        title={isGuest ? 'La contraseña de la cuenta compartida se cambia en VITE_GUEST_PASSWORD' : 'Cambiar contraseña'}
                        aria-label={`Cambiar contraseña de ${u.username}`}
                        disabled={isGuest}
                        onClick={() => setPasswordTarget(u)}
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.09] hover:bg-white/15 active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    <button
                      title={isSelf ? 'No puedes eliminar tu propia cuenta' : 'Eliminar usuario'}
                      aria-label={`Eliminar a ${u.username}`}
                      disabled={isSelf}
                      onClick={() => setDeleteTarget(u)}
                      className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-white/[0.09] text-red-400 hover:bg-white/15 active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Picks which songs of the shared catalog are preloaded into the guest account ("Ingresa sin cuenta"). */
function GuestSeedSection() {
  const [songs, setSongs] = useState<{ id: string; title: string; artist: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    adminApi
      .guestSeed()
      .then((d) => {
        setSongs(d.songs);
        setSelected(new Set(d.selected));
        setSaved(new Set(d.selected));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const dirty = selected.size !== saved.size || [...selected].some((id) => !saved.has(id));
  const q = query.trim().toLowerCase();
  const visible = q ? songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q)) : songs;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.saveGuestSeed([...selected]);
      setSaved(new Set(selected));
      setNotice('Selección guardada');
      setTimeout(() => setNotice(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
        Canciones iniciales del invitado ({selected.size}/{songs.length})
      </label>
      <p className="text-[11px] text-zinc-500 leading-snug">
        La cuenta de invitado no ve el cancionero general: tiene sus propias canciones, favoritos y grupos. Las canciones
        marcadas se copian una sola vez a su cuenta; quitarlas después no borra las que ya recibió.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar canción…"
        className={INPUT}
        aria-label="Buscar canción"
      />
      <div className="max-h-56 overflow-y-auto no-scrollbar rounded-3xl bg-black/25 border border-white/10 p-1.5">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin opacity-60" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-6 text-center text-xs text-zinc-500">Sin canciones</div>
        ) : (
          visible.map((song) => {
            const on = selected.has(song.id);
            return (
              <button
                key={song.id}
                type="button"
                onClick={() => toggle(song.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-left hover:bg-white/[0.06] transition-colors"
              >
                <span
                  className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${
                    on ? 'bg-[oklch(0.82_0.14_75)] border-[oklch(0.82_0.14_75)] text-[#17130a]' : 'border-white/25'
                  }`}
                >
                  {on && <Check className="w-3.5 h-3.5" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{song.title}</span>
                  {song.artist && <span className="block text-[11px] text-zinc-500 truncate">{song.artist}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span role="status" className={`text-xs font-bold ${error ? 'text-[oklch(0.7_0.19_22)]' : 'text-emerald-400'}`}>
          {error ?? notice ?? ''}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="h-9 px-4 rounded-full bg-[oklch(0.82_0.14_75)] text-[#17130a] text-xs font-extrabold disabled:opacity-40 active:scale-95 transition"
        >
          {saving ? '...' : 'Guardar selección'}
        </button>
      </div>
    </div>
  );
}
