import React, { useState, useEffect } from 'react';
import {
  CloudCheck,
  CloudOff,
  RefreshCw,
  Download,
  Trash2,
  HardDrive,
  RotateCcw,
  LogOut,
  KeyRound,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { CloudSyncStatus } from '../types/song';
import { ConfirmDialog } from './ConfirmDialog';
import { useAuth } from './AuthGate';
import { authApi } from '../utils/auth';
import { ScreenShell, SectionTitle, Row, RowGroup, Avatar, CARD, FIELD, PRIMARY_BTN, SOFT_BTN } from './ScreenShell';
import { getLocalSongs, restoreStarterSongs, triggerCloudSync, subscribeToSyncStatus } from '../utils/storage';

interface AccountScreenProps {
  onBack: () => void;
  onRefresh: () => void;
}

export function AccountScreen({ onBack, onRefresh }: AccountScreenProps) {
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>({
    lastSyncAt: null,
    isSyncing: false,
    pendingChanges: 0,
    online: true,
    error: null,
  });
  const [notification, setNotification] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { user, logout } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => subscribeToSyncStatus(setSyncStatus), []);

  const showNotif = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const handleManualSync = async () => {
    const res = await triggerCloudSync();
    if (res.success) {
      showNotif(`¡Sincronización completada! ${res.count || 0} canciones al día.`);
      onRefresh();
    } else {
      showNotif('No se pudo conectar a la nube. Los cambios siguen seguros en tu dispositivo.');
    }
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(getLocalSongs(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lirika_canciones_respaldo_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotif('Copia de seguridad descargada.');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setShowPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      showNotif('Contraseña actualizada.');
    } catch (err: any) {
      setPasswordError(err.message);
    }
  };

  const songCount = getLocalSongs().length;
  const isAdmin = user.role === 'admin';

  return (
    <ScreenShell title="Cuenta" subtitle="Tu perfil, la nube y tus copias" onBack={onBack} notice={notification}>
      <ConfirmDialog
        open={confirmReset}
        icon={<RotateCcw className="w-6 h-6" />}
        title="¿Restablecer el cancionero?"
        message="Volverán las canciones iniciales que quitaste de tu cuenta. No se toca nada de lo que creaste o editaste."
        onClose={() => setConfirmReset(false)}
        actions={[
          { label: 'Cancelar', onClick: () => setConfirmReset(false) },
          {
            label: 'Restablecer',
            tone: 'primary',
            onClick: async () => {
              setConfirmReset(false);
              const res = await restoreStarterSongs();
              onRefresh();
              if (!res.success) showNotif('No se pudo restablecer. Revisa tu conexión.');
              else showNotif(res.restored ? `Canciones iniciales restauradas (${res.restored}).` : 'Ya tienes todas las canciones iniciales.');
            },
          },
        ]}
      />

      {/* Profile */}
      <section className={`${CARD} p-4 flex items-center gap-3.5`}>
        <Avatar name={user.username} size={52} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold truncate">{user.username}</div>
          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[oklch(0.82_0.14_75_/_0.16)] text-[oklch(0.82_0.14_75)]">
            {isAdmin && <ShieldCheck className="w-3 h-3" />}
            {isAdmin ? 'Administrador' : user.isGuest ? 'Invitado' : 'Usuario'}
          </span>
        </div>
        <button onClick={logout} className={SOFT_BTN}>
          <LogOut className="w-3.5 h-3.5" />
          Salir
        </button>
      </section>

      {/* Security */}
      {!user.isGuest && (
      <section>
        <SectionTitle>Seguridad</SectionTitle>
        <div className={`${CARD} overflow-hidden`}>
          <Row
            icon={<KeyRound className="w-4 h-4" />}
            label="Cambiar contraseña"
            hint="Mínimo 8 caracteres"
            onClick={() => setShowPassword((v) => !v)}
            right={<ChevronDown className={`w-4 h-4 opacity-50 transition-transform ${showPassword ? 'rotate-180' : ''}`} />}
          />
          {showPassword && (
            <form onSubmit={handleChangePassword} className="px-4 pb-4 pt-1 space-y-2.5 border-t border-white/10">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Contraseña actual"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={`${FIELD} mt-3`}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Nueva contraseña"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={FIELD}
              />
              {passwordError && (
                <p role="alert" className="text-xs font-semibold text-[oklch(0.78_0.15_22)]">
                  {passwordError}
                </p>
              )}
              <button type="submit" disabled={!currentPassword || newPassword.length < 8} className={`${PRIMARY_BTN} w-full`}>
                Guardar contraseña
              </button>
            </form>
          )}
        </div>
      </section>
      )}

      {/* Cloud */}
      <section>
        <SectionTitle>Sincronización</SectionTitle>
        <div className={`${CARD} p-4 space-y-3.5`}>
          <div className="flex items-center gap-3">
            <span
              className={`w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center bg-white/[0.08] ${
                syncStatus.online ? 'text-emerald-400' : 'text-[oklch(0.82_0.14_75)]'
              }`}
            >
              {syncStatus.online ? <CloudCheck className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{syncStatus.online ? 'Nube conectada' : 'Sin conexión'}</div>
              <div className="text-[11px] opacity-50 truncate">
                {syncStatus.lastSyncAt
                  ? `Última sincronización: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
                  : 'Aún no sincronizado'}
              </div>
            </div>
            <button onClick={handleManualSync} disabled={syncStatus.isSyncing} className={SOFT_BTN}>
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.isSyncing ? 'animate-spin' : ''}`} />
              {syncStatus.isSyncing ? 'Sincronizando' : 'Sincronizar'}
            </button>
          </div>
          <p className="text-xs opacity-55 leading-relaxed">
            Tus letras se guardan al instante en tu dispositivo y funcionan sin internet; se respaldan en la nube cuando hay
            conexión.
          </p>
        </div>
      </section>

      {/* Data */}
      <section>
        <SectionTitle>Tus datos</SectionTitle>
        <RowGroup>
          <Row
            icon={<HardDrive className="w-4 h-4" />}
            label="Almacenado en este dispositivo"
            right={<span className="text-sm font-bold tabular-nums">{songCount} {songCount === 1 ? 'canción' : 'canciones'}</span>}
          />
          <Row
            icon={<Download className="w-4 h-4" />}
            label="Exportar canciones"
            hint="Copia de seguridad en JSON"
            onClick={handleExportJSON}
          />
          {!isAdmin && (
            <Row
              icon={<RotateCcw className="w-4 h-4" />}
              label="Restablecer cancionero"
              hint="Recupera las canciones iniciales que quitaste"
              onClick={() => setConfirmReset(true)}
            />
          )}
        </RowGroup>
      </section>
    </ScreenShell>
  );
}
