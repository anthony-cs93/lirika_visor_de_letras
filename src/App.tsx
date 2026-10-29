import React, { useState, useEffect } from 'react';
import { Song, ThemeMode } from './types/song';
import { SongList } from './components/SongList';
import { SongViewer } from './components/SongViewer';
import { SongEditor } from './components/SongEditor';
import { LyricsSearchModal } from './components/LyricsSearchModal';
import { SettingsModal } from './components/SettingsModal';
import { getPreferences, savePreferences } from './utils/storage';

type AppView = 'list' | 'viewer' | 'editor';

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

  // Handlers
  const handleOpenSong = (song: Song) => {
    setSelectedSong(song);
    setCurrentView('viewer');
  };

  const handleEditSong = (song: Song) => {
    setEditingSong(song);
    setCurrentView('editor');
  };

  const handleNewSong = () => {
    setEditingSong(null);
    setCurrentView('editor');
  };

  const [toast, setToast] = useState<string | null>(null);
  const handleSavedSong = (song: Song) => {
    setSelectedSong(song);
    setCurrentView('viewer');
    setToast('Cambios guardados ✓');
    setTimeout(() => setToast(null), 2200);
  };

  const handleSongCreatedFromUpload = (song: Song) => {
    setSelectedSong(song);
    setCurrentView('viewer');
  };

  return (
    <div className={`w-full h-screen bg-zinc-950 font-sans antialiased text-zinc-100 flex flex-col justify-center items-center overflow-hidden ${isLight ? 'light' : ''}`}>
      {/* App Container - Responsive Mobile-first canvas that expands cleanly */}
      <main className="w-full h-full max-w-2xl bg-zinc-950 flex flex-col relative shadow-2xl border-x border-zinc-800/60 overflow-hidden">
        {currentView === 'list' && (
          <SongList
            onSelectSong={handleOpenSong}
            onNewSong={handleNewSong}
            onOpenUpload={() => setIsUploadOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isLight={isLight}
            onToggleTheme={toggleTheme}
          />
        )}

        {currentView === 'viewer' && selectedSong && (
          <SongViewer
            song={selectedSong}
            onBack={() => {
              setCurrentView('list');
              setSelectedSong(null);
            }}
            onEdit={(songToEdit) => {
              setEditingSong(songToEdit);
              setCurrentView('editor');
            }}
          />
        )}

        {currentView === 'editor' && (
          <SongEditor
            song={editingSong}
            onBack={() => {
              if (selectedSong) {
                setCurrentView('viewer');
              } else {
                setCurrentView('list');
              }
            }}
            onSaved={handleSavedSong}
          />
        )}

        {toast && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-full bg-zinc-900/80 border border-white/20 backdrop-blur-xl text-[13px] font-bold shadow-xl">
            {toast}
          </div>
        )}

        {/* Upload Modal */}
        <LyricsSearchModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onSongCreated={handleSongCreatedFromUpload}
        />

        {/* Settings & Cloud Sync Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => {
            setIsSettingsOpen(false);
            setUserPrefs(getPreferences());
          }}
          onRefresh={() => {
            setUserPrefs(getPreferences());
          }}
        />
      </main>
    </div>
  );
}
