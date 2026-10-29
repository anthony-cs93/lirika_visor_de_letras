import React, { useState, useEffect, useRef } from 'react';
import { Song } from './types/song';
import { SongList } from './components/SongList';
import { SongViewer } from './components/SongViewer';
import { SongEditor } from './components/SongEditor';
import { LyricsSearchModal } from './components/LyricsSearchModal';
import { SettingsModal } from './components/SettingsModal';
import { getPreferences, savePreferences } from './utils/storage';

type AppView = 'list' | 'viewer' | 'editor';
type ModalKind = 'search' | 'settings';

// Every screen/modal the user opens is a browser-history entry, so the system back
// gesture/button closes it. Entry 0 is a sentinel ('exit') that triggers the leave confirmation.
interface NavState {
  app: true;
  view: AppView | 'exit';
  modal?: ModalKind;
}
const navState = (): NavState | null => (history.state?.app ? (history.state as NavState) : null);

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('list');
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // User default preferences
  const [userPrefs, setUserPrefs] = useState(getPreferences());

  useEffect(() => {
    setUserPrefs(getPreferences());
  }, []);

  const isLight = userPrefs.themeMode === 'light';
  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight);
  }, [isLight]);
  const toggleTheme = () => setUserPrefs(savePreferences({ themeMode: isLight ? 'dark' : 'light' }));

  // ---- Navigation (history-driven) ----
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const selectedRef = useRef<Song | null>(null);
  const editorFromViewer = useRef(false);
  const skipUnloadPrompt = useRef(false);

  const applyNav = (view: AppView, modal?: ModalKind) => {
    setCurrentView(view);
    setIsUploadOpen(modal === 'search');
    setIsSettingsOpen(modal === 'settings');
  };

  const pushNav = (view: AppView, modal?: ModalKind) => {
    history.pushState({ app: true, view, modal } satisfies NavState, '');
    applyNav(view, modal);
  };

  const replaceNav = (view: AppView, modal?: ModalKind) => {
    history.replaceState({ app: true, view, modal } satisfies NavState, '');
    applyNav(view, modal);
  };

  const selectSong = (song: Song | null) => {
    selectedRef.current = song;
    setSelectedSong(song);
  };

  const goBack = () => history.back();

  useEffect(() => {
    const s = navState();
    if (s?.view === 'exit') {
      history.pushState({ app: true, view: 'list' } satisfies NavState, '');
    } else if (s) {
      history.replaceState({ app: true, view: 'list' } satisfies NavState, '');
    } else {
      history.replaceState({ app: true, view: 'exit' } satisfies NavState, '');
      history.pushState({ app: true, view: 'list' } satisfies NavState, '');
    }

    const onPop = () => {
      const st = navState();
      if (!st || st.view === 'exit') {
        // Back past the first screen: stay in the app and ask first
        history.pushState({ app: true, view: 'list' } satisfies NavState, '');
        applyNav('list');
        selectSong(null);
        setShowExitConfirm(true);
        return;
      }
      setShowExitConfirm(false);
      let view = st.view;
      if (view === 'viewer' && !selectedRef.current) view = 'list';
      if (view === 'list') selectSong(null);
      applyNav(view, st.modal);
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (skipUnloadPrompt.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    // Swipe right from the left edge = back (for devices without a system back gesture)
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      tracking = t.clientX <= 24;
      startX = t.clientX;
      startY = t.clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const st = navState();
      if (t.clientX - startX > 70 && Math.abs(t.clientY - startY) < 60 && st && (st.view !== 'list' || st.modal)) {
        history.back();
      }
    };

    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const confirmExit = () => {
    skipUnloadPrompt.current = true;
    setShowExitConfirm(false);
    // Leave the sentinel and list entries behind
    history.go(-2);
    setTimeout(() => {
      skipUnloadPrompt.current = false;
    }, 1000);
  };

  // Handlers
  const handleOpenSong = (song: Song) => {
    selectSong(song);
    pushNav('viewer');
  };

  const handleNewSong = () => {
    setEditingSong(null);
    editorFromViewer.current = false;
    pushNav('editor');
  };

  const closeModal = () => {
    if (navState()?.modal) history.back();
    else applyNav(currentView);
  };

  const [toast, setToast] = useState<string | null>(null);
  const handleSavedSong = (song: Song) => {
    selectSong(song);
    setToast('Cambios guardados ✓');
    setTimeout(() => setToast(null), 2200);
    if (editorFromViewer.current) {
      editorFromViewer.current = false;
      history.back(); // back to the viewer entry underneath the editor
    } else {
      replaceNav('viewer'); // editor entry becomes the viewer
    }
  };

  const handleSongCreatedFromUpload = (song: Song) => {
    selectSong(song);
    replaceNav('viewer'); // replaces the search-modal entry
  };

  return (
    <div className={`w-full app-height bg-zinc-950 font-sans antialiased text-zinc-100 flex flex-col justify-center items-center overflow-hidden ${isLight ? 'light' : ''}`}>
      {/* App Container - Responsive Mobile-first canvas that expands cleanly */}
      <main className="w-full h-full max-w-2xl bg-zinc-950 flex flex-col relative shadow-2xl border-x border-zinc-800/60 overflow-hidden">
        {currentView === 'list' && (
          <SongList
            onSelectSong={handleOpenSong}
            onNewSong={handleNewSong}
            onOpenUpload={() => pushNav('list', 'search')}
            onOpenSettings={() => pushNav('list', 'settings')}
            isLight={isLight}
            onToggleTheme={toggleTheme}
          />
        )}

        {currentView === 'viewer' && selectedSong && (
          <SongViewer
            song={selectedSong}
            onBack={goBack}
            onEdit={(songToEdit) => {
              setEditingSong(songToEdit);
              editorFromViewer.current = true;
              pushNav('editor');
            }}
          />
        )}

        {currentView === 'editor' && <SongEditor song={editingSong} onBack={goBack} onSaved={handleSavedSong} />}

        {toast && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-full bg-zinc-900/80 border border-white/20 backdrop-blur-xl text-[13px] font-bold shadow-xl">
            {toast}
          </div>
        )}

        {/* Lyrics web search modal */}
        <LyricsSearchModal
          isOpen={isUploadOpen}
          onClose={closeModal}
          onSongCreated={handleSongCreatedFromUpload}
        />

        {/* Settings & Cloud Sync Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => {
            closeModal();
            setUserPrefs(getPreferences());
          }}
          onRefresh={() => {
            setUserPrefs(getPreferences());
          }}
        />

        {showExitConfirm && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-zinc-900/90 border border-white/15 p-5 text-center shadow-2xl">
              <h2 className="text-base font-bold">¿Salir de Lirika?</h2>
              <p className="text-xs text-zinc-400 mt-1.5">Tus letras quedan guardadas en tu biblioteca.</p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-2.5 rounded-full text-sm font-extrabold bg-[oklch(0.82_0.14_75)] text-[#17130a]"
                >
                  Quedarme
                </button>
                <button
                  onClick={confirmExit}
                  className="flex-1 py-2.5 rounded-full text-sm font-bold border border-white/20 hover:bg-white/10"
                >
                  Salir
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
