import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useMemory } from '../lib/memory'
import { GROUP_PROFILE_ID } from '../lib/profiles'
import type { HealthInfo } from '../types'
import {
  BookmarkIcon,
  FilmIcon,
  HistoryIcon,
  HomeIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from './icons'

const NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/hindi', label: 'Hindi', Icon: FilmIcon },
  { to: '/history', label: 'History', Icon: HistoryIcon },
  { to: '/watchlist', label: 'Wishlist', Icon: BookmarkIcon },
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="tabular-nums text-xs font-medium text-white/35 lg:text-sm">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

export function NavBar({ onSettings, onProfiles }: { onSettings: () => void; onProfiles: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const memory = useMemory()
  const [health, setHealth] = useState<HealthInfo | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 md:px-6">
        <button
          type="button"
          data-nav
          onClick={() => navigate('/')}
          className="flex shrink-0 items-center gap-2.5 rounded-xl py-1 pr-2 text-left"
          aria-label="Home Movie Theatre — home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-deep">
            <PlayIcon width={17} height={17} className="text-white" />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[0.95rem] font-black tracking-tight">
              HOME <span className="text-brand">MOVIE</span> THEATRE
            </span>
            <span className="block text-[0.55rem] font-bold uppercase tracking-[0.22em] text-white/30">
              For {memory.profileName}
            </span>
          </span>
        </button>

        <nav className="flex items-center gap-1" aria-label="Main navigation">
          {NAV.map(({ to, label, Icon }) => {
            const active = location.pathname === to
            return (
              <button
                key={to}
                type="button"
                data-nav
                onClick={() => navigate(to)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${
                  active ? 'bg-brand text-white' : 'text-white/55 hover:bg-white/[0.07] hover:text-white'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon width={16} height={16} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.62rem] font-semibold text-white/45 xl:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health ? (health.ai.configured ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-white/30'
              }`}
            />
            {health?.ai.configured ? 'Gemini online' : 'Local picks'}
          </span>

          <Clock />

          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {memory.ready ? (
              <button
                type="button"
                data-nav
                onClick={() => memory.setProfile(GROUP_PROFILE_ID)}
                title="Everyone — combined taste for watching together"
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold transition ${
                  memory.profile === GROUP_PROFILE_ID
                    ? 'bg-gold text-black'
                    : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <UsersIcon width={12} height={12} />
                All
              </button>
            ) : null}

            {memory.ready
              ? memory.profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-nav
                    onClick={() => memory.setProfile(p.id)}
                    title={`${p.name} — ${p.role}`}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold transition ${
                      memory.profile === p.id
                        ? 'bg-gold text-black'
                        : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <UserIcon width={12} height={12} />
                    {p.name}
                  </button>
                ))
              : null}

            <button
              type="button"
              data-nav
              onClick={onProfiles}
              title="Add or manage people"
              aria-label="Add or manage people"
              className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-white/45 transition hover:bg-white/[0.08] hover:text-white"
            >
              <PlusIcon width={13} height={13} />
              <span className="hidden 2xl:inline">Add</span>
            </button>
          </div>

          <button
            type="button"
            data-nav
            onClick={onSettings}
            className="rounded-xl p-2 text-white/60 transition hover:bg-white/[0.08] hover:text-white"
            title="Memory & settings"
            aria-label="Settings"
          >
            <SettingsIcon width={20} height={20} />
          </button>
        </div>
      </div>
    </header>
  )
}
