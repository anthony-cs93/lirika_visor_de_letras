import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Trash2, Loader2, KeyRound, Check, Search, X } from 'lucide-react';
import { AuthUser, Role, EMAIL_MAX, adminApi, isValidEmail, sanitizeEmailInput } from '../utils/auth';
import { ConfirmDialog } from './ConfirmDialog';
import { useAuth } from './AuthGate';
import { ScreenShell, SectionTitle, Avatar, CARD, FIELD, PRIMARY_BTN } from './ScreenShell';

// The shared "Ingresa sin cuenta" account: its password lives in VITE_GUEST_PASSWORD, so it is not changed from here
const GUEST_USERNAME = ((import.meta.env.VITE_GUEST_USERNAME as string | undefined) || '').trim().toLowerCase();

const ICON_BTN =
  'w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-white/[0.09] hover:bg-white/15 active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed';

/** Admin-only account management: list, create and delete users, and pick the guest's starting songs. */
export function AdminScreen({ onBack }: { onBack: () => void }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
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

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await adminApi.create({ username: email, password, role });
      setEmail('');
      setPassword('');
      setRole('user');
      setShowCreate(false);
      flash('Usuario creado');
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
      flash(`Contraseña de ${passwordTarget.username} actualizada`);
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

  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <ScreenShell
      title="Administración"
      subtitle={loading ? 'Cargando…' : `${users.length} ${users.length === 1 ? 'usuario' : 'usuarios'} · ${adminCount} ${adminCount === 1 ? 'administrador' : 'administradores'}`}
      onBack={onBack}
      notice={notice}
      error={error}
    >
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

      {/* Users */}
      <section>
        <SectionTitle
          aside={
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="h-8 pl-2.5 pr-3 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 bg-[oklch(0.82_0.14_75)] text-[#17130a] active:scale-95 transition-transform"
            >
              {showCreate ? <X className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              {showCreate ? 'Cancelar' : 'Nuevo'}
            </button>
          }
        >
          Usuarios
        </SectionTitle>

        {showCreate && (
          <form onSubmit={handleCreate} className={`${CARD} p-4 mb-3 space-y-2.5`}>
            <input
              className={FIELD}
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
              className={FIELD}
              type="text"
              placeholder="Contraseña (mínimo 8 caracteres)"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <div className="flex-1 flex p-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-bold">
                {(['user', 'admin'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 rounded-full py-2 transition-colors ${
                      role === r ? 'bg-[oklch(0.82_0.14_75_/_0.2)] text-[oklch(0.82_0.14_75)]' : 'opacity-60'
                    }`}
                  >
                    {r === 'admin' ? 'Administrador' : 'Usuario'}
                  </button>
                ))}
              </div>
              <button type="submit" disabled={creating || !isValidEmail(email) || password.length < 8} className={PRIMARY_BTN}>
                {creating ? '...' : 'Crear'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin opacity-60" />
          </div>
        ) : (
          <div className={`${CARD} overflow-hidden divide-y divide-white/10`}>
            {users.map((u) => {
              const isSelf = u.id === me.id;
              const isGuest = !!GUEST_USERNAME && u.username === GUEST_USERNAME;
              return (
                <div key={u.id} className="px-4 py-3 flex items-center gap-3">
                  <Avatar name={u.username} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {u.username}
                      {isSelf && <span className="ml-1.5 text-[10px] opacity-55">(tú)</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] opacity-60">
                      <span
                        className={`px-1.5 rounded-full text-[10px] font-bold ${
                          u.role === 'admin' ? 'bg-[oklch(0.82_0.14_75_/_0.16)] text-[oklch(0.82_0.14_75)]' : 'bg-white/10'
                        }`}
                      >
                        {u.role === 'admin' ? 'Admin' : 'Usuario'}
                      </span>
                      <span className="truncate">
                        {u.lastLoginAt ? `acceso ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'nunca ha entrado'}
                      </span>
                    </div>
                  </div>
                  <button
                    title={isGuest ? 'La contraseña de la cuenta compartida se cambia en VITE_GUEST_PASSWORD' : 'Cambiar contraseña'}
                    aria-label={`Cambiar contraseña de ${u.username}`}
                    disabled={isGuest}
                    onClick={() => setPasswordTarget(u)}
                    className={ICON_BTN}
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                  <button
                    title={isSelf ? 'No puedes eliminar tu propia cuenta' : 'Eliminar usuario'}
                    aria-label={`Eliminar a ${u.username}`}
                    disabled={isSelf}
                    onClick={() => setDeleteTarget(u)}
                    className={`${ICON_BTN} text-red-400`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <GuestSeedSection />
    </ScreenShell>
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
    <section>
      <SectionTitle
        aside={
          <span className="text-[11px] font-bold tabular-nums opacity-60">
            {selected.size}/{songs.length}
          </span>
        }
      >
        Canciones del invitado
      </SectionTitle>
      <div className={`${CARD} p-4 space-y-3`}>
        <p className="text-xs opacity-55 leading-relaxed">
          Cada cuenta tiene sus propias canciones, favoritos y grupos. Aquí aparecen las canciones de las cuentas de
          administrador; las marcadas se copian una sola vez a la cuenta del invitado y quitarlas después no borra las que ya recibió.
        </p>
        <div className="h-10 rounded-full flex items-center gap-2.5 px-4 bg-white/[0.06] border border-white/15">
          <Search className="w-4 h-4 opacity-55 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:opacity-40"
            aria-label="Buscar canción"
          />
        </div>
        <div className="max-h-64 overflow-y-auto no-scrollbar -mx-1.5">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin opacity-60" />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-6 text-center text-xs opacity-50">Sin canciones</div>
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
                    {song.artist && <span className="block text-[11px] opacity-50 truncate">{song.artist}</span>}
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
          <button type="button" onClick={save} disabled={!dirty || saving} className={PRIMARY_BTN}>
            {saving ? '...' : 'Guardar selección'}
          </button>
        </div>
      </div>
    </section>
  );
}
