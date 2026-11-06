import { useEffect, useState } from 'react'
import { HashRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NavBar } from './components/NavBar'
import { ProfilesPanel } from './components/ProfilesPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { MemoryProvider } from './lib/memory'
import { installSpatialNav } from './lib/nav'
import { installSfx } from './lib/sfx'
import { HindiPage } from './pages/Hindi'
import { HistoryPage } from './pages/History'
import { HomePage } from './pages/Home'
import { WatchPage } from './pages/Watch'
import { WatchlistPage } from './pages/Watchlist'

function RemoteNavigation() {
  const location = useLocation()

  useEffect(() => {
    // The player handles its own keys (seek / volume / pause).
    if (location.pathname.startsWith('/watch')) return
    return installSpatialNav()
  }, [location.pathname])

  return null
}

function AppLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profilesOpen, setProfilesOpen] = useState(false)

  useEffect(() => installSfx(), [])

  return (
    <div className="min-h-screen">
      <NavBar
        onSettings={() => setSettingsOpen(true)}
        onProfiles={() => setProfilesOpen(true)}
      />
      <Outlet />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProfilesPanel open={profilesOpen} onClose={() => setProfilesOpen(false)} />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <MemoryProvider>
        <HashRouter>
          <RemoteNavigation />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/hindi" element={<HindiPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/watchlist" element={<WatchlistPage />} />
            </Route>
            <Route path="/watch/:slug" element={<WatchPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </HashRouter>
      </MemoryProvider>
    </ErrorBoundary>
  )
}
