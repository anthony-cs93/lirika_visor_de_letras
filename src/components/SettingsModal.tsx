import React, { useState, useEffect } from 'react';
import {
  X,
  Cloud,
  CloudCheck,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Check,
  Moon,
  Sun,
  Flame,
  HardDrive,
  Info,
  RotateCcw,
} from 'lucide-react';
import { CloudSyncStatus, ThemeMode } from '../types/song';
import { ConfirmDialog } from './ConfirmDialog';
import {
  getLocalSongs,
  resetToInitialSongs,
  triggerCloudSync,
  subscribeToSyncStatus,
  getPreferences,
  savePreferences,
} from '../utils/storage';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function SettingsModal({ isOpen, onClose, onRefresh }: SettingsModalProps) {
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>({
    lastSyncAt: null,
    isSyncing: false,
    pendingChanges: 0,
    online: true,
    error: null,
  });

  const [prefs, setPrefs] = useState(getPreferences());
  const [notification, setNotification] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const unsub = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });
    return () => unsub();
  }, []);

  if (!isOpen) return null;

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
    const songs = getLocalSongs();
    const blob = new Blob([JSON.stringify(songs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lirika_canciones_respaldo_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotif('Copia de seguridad descargada.');
  };

  const handleResetCatalog = () => {
    setConfirmReset(true);
  };

  const songs = getLocalSongs();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <ConfirmDialog
        open={confirmReset}
        tone="danger"
        icon={<RotateCcw className="w-6 h-6" />}
        title="¿Restablecer el cancionero?"
        message="Tu cancionero se reemplazará por las canciones iniciales. Descarga una copia de seguridad antes si quieres conservar tus letras."
        onClose={() => setConfirmReset(false)}
        actions={[
          { label: 'Cancelar', onClick: () => setConfirmReset(false) },
          {
            label: 'Restablecer',
            tone: 'danger',
            onClick: () => {
              setConfirmReset(false);
              resetToInitialSongs();
              onRefresh();
              showNotif('Cancionero restablecido.');
            },
          },
        ]}
      />
      <div className="w-full max-w-lg bg-white/[0.06] backdrop-blur-xl border border-white/10 text-[color:var(--ink)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold">Ajustes & Sincronización</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-[color:var(--ink)] rounded-2xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {notification && (
          <div className="px-5 py-2.5 bg-emerald-950 border-b border-emerald-900 text-xs text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{notification}</span>
          </div>
        )}

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* Cloud Synchronization Section */}
          <div className="bg-black/25 p-4 rounded-3xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    syncStatus.online ? 'bg-emerald-400' : 'bg-[oklch(0.82_0.14_75)]'
                  }`}
                />
                <span className="font-semibold text-xs uppercase tracking-wider text-zinc-300">
                  {syncStatus.online ? 'Nube Conectada' : 'Modo Offline (Sin Internet)'}
                </span>
              </div>
              <button
                onClick={handleManualSync}
                disabled={syncStatus.isSyncing}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white/15 hover:bg-white/15 disabled:opacity-50 text-zinc-200 rounded-2xl border border-white/15 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.isSyncing ? 'animate-spin' : ''}`} />
                <span>{syncStatus.isSyncing ? 'Sincronizando...' : 'Sincronizar ahora'}</span>
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Tus letras se guardan de forma instantánea en tu dispositivo para que funcionen 100% offline,
              y se respaldan en la nube automáticamente cuando hay conexión a internet.
            </p>

            <div className="text-[11px] text-zinc-500 space-y-1">
              <div>
                Última sincronización:{' '}
                <span className="text-zinc-300 font-mono">
                  {syncStatus.lastSyncAt
                    ? new Date(syncStatus.lastSyncAt).toLocaleString()
                    : 'Aún no sincronizado'}
                </span>
              </div>
            </div>
          </div>

          {/* Backup & Export */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Copia de Seguridad y Archivos
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleExportJSON}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-black/25 hover:bg-white/10 border border-white/10 rounded-3xl text-xs font-medium text-zinc-200 transition-colors"
              >
                <Download className="w-4 h-4 text-amber-400" />
                <span>Exportar Canciones (JSON)</span>
              </button>
              <button
                onClick={handleResetCatalog}
                disabled
                title="Próximamente"
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-black/25 border border-white/10 rounded-3xl text-xs font-medium text-zinc-300 opacity-50 cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>Restablecer Cancionero</span>
              </button>
            </div>
          </div>

          {/* Device & Storage Info */}
          <div className="flex items-center justify-between p-3 bg-black/25 rounded-3xl border border-white/10 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-zinc-500" />
              <span>Memoria Local Offline:</span>
            </div>
            <span className="font-semibold text-zinc-200">{songs.length} canciones almacenadas</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/15 hover:bg-white/15 text-xs font-medium text-zinc-200 rounded-2xl transition-colors"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
