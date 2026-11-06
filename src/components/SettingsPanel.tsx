import { useEffect, useState } from 'react'
import { aiProviderLabel, api, imgSrc, prettyTitle, streamMode } from '../lib/api'
import { useMemory } from '../lib/memory'
import { focusFirst } from '../lib/nav'
import { getSfxEnabled, setSfxEnabled, subscribeSfx } from '../lib/sfx'
import type { HealthInfo } from '../types'
import { BookmarkIcon, CheckIcon, DownloadIcon, HeartIcon, ThumbDownIcon, TrashIcon, XIcon } from './icons'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

type Tab = 'liked' | 'disliked' | 'watchlist' | 'history'

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      data-nav
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
    >
      <span className="min-w-0">
        <span className="block text-[0.95rem] font-semibold text-white/90">{label}</span>
        <span className="mt-0.5 block text-xs text-white/40">{hint}</span>
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-brand' : 'bg-white/15'}`}
        aria-hidden
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`}
        />
      </span>
    </button>
  )
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const memory = useMemory()
  const [tab, setTab] = useState<Tab>('liked')
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sfx, setSfx] = useState(() => getSfxEnabled())

  useEffect(() => subscribeSfx(setSfx), [])

  useEffect(() => {
    if (!open) return
    document.body.classList.add('modal-open')
    focusFirst('[data-modal="true"] [data-nav]')
    api.health().then(setHealth).catch(() => setHealth(null))
    const onBack = () => onClose()
    document.addEventListener('tv-back', onBack)
    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('tv-back', onBack)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!confirmReset) return
    const timer = setTimeout(() => setConfirmReset(false), 6000)
    return () => clearTimeout(timer)
  }, [confirmReset])

  if (!open) return null

  const liked = memory.likes
  const disliked = memory.dislikes
  const rows =
    tab === 'liked'
      ? liked.map((r) => ({ slug: r.slug, title: r.title, thumb: r.thumb, sub: 'Liked', remove: () => memory.rate({ ...r }, null) }))
      : tab === 'disliked'
        ? disliked.map((r) => ({
            slug: r.slug,
            title: r.title,
            thumb: r.thumb,
            sub: 'Disliked',
            remove: () => memory.rate({ ...r }, null),
          }))
        : tab === 'watchlist'
          ? memory.watchlist.map((w) => ({
              slug: w.slug,
              title: w.title,
              thumb: w.thumb,
              sub: new Date(w.addedAt).toLocaleDateString(),
              remove: () => memory.removeWatchlist(w.slug),
            }))
          : memory.history.map((h) => ({
              slug: h.slug,
              title: h.title,
              thumb: h.thumb,
              sub: h.completed
                ? 'Watched'
                : `Resume at ${Math.floor(h.positionSec / 60)}m · ${new Date(h.updatedAt).toLocaleDateString()}`,
              remove: () => memory.removeHistory(h.slug),
            }))

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setBusy(true)
    await memory.resetMemory()
    setBusy(false)
    setConfirmReset(false)
  }

  return (
    <div
      data-modal="true"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside className="absolute right-0 top-0 h-full w-full max-w-3xl animate-pop overflow-y-auto border-l border-white/10 bg-panel p-5 shadow-2xl md:p-7">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Memory & settings</p>
            <h2 className="text-2xl font-black tracking-tight">Made for you</h2>
          </div>
          <button type="button" data-nav onClick={onClose} className="btn-ghost !p-2" aria-label="Close settings">
            <XIcon width={22} height={22} />
          </button>
        </div>

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-white/40">Preferences</h3>
          <div className="space-y-2">
            <Toggle
              on={memory.prefs.preferHindi}
              onClick={() => memory.setPrefs({ preferHindi: !memory.prefs.preferHindi })}
              label="Prefer Hindi audio"
              hint="Recommendations will favour titles whose source lists Hindi audio."
            />
            <Toggle
              on={memory.prefs.familyOnly}
              onClick={() => memory.setPrefs({ familyOnly: !memory.prefs.familyOnly })}
              label="Family-friendly mode"
              hint="Filters toward Family/Animation. Content ratings aren’t always available, so treat suggestions as guidance."
            />
            <Toggle
              on={memory.prefs.tts}
              onClick={() => memory.setPrefs({ tts: !memory.prefs.tts })}
              label="Speak AI replies"
              hint="Uses the TV browser’s speech synthesis when supported."
            />
            <Toggle
              on={sfx}
              onClick={() => setSfxEnabled(!sfx)}
              label="Interface sounds"
              hint="Soft ticks as you move, a chime when the AI finds new picks."
            />
          </div>
        </section>

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 flex items-center justify-between text-sm font-bold uppercase tracking-widest text-white/40">
            <span>Memory</span>
            <span className="text-[0.65rem] normal-case tracking-normal text-white/30">saved on this TV’s browser</span>
          </h3>

          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {(
              [
                ['liked', 'Liked', liked.length],
                ['disliked', 'Disliked', disliked.length],
                ['watchlist', 'Watchlist', memory.watchlist.length],
                ['history', 'History', memory.history.length],
              ] as [Tab, string, number][]
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                data-nav
                onClick={() => setTab(id)}
                className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                  tab === id ? 'bg-brand text-white' : 'bg-white/[0.05] text-white/55 hover:bg-white/[0.09]'
                }`}
              >
                {label}
                <span className={`ml-1 ${tab === id ? 'text-white/70' : 'text-white/30'}`}>{count}</span>
              </button>
            ))}
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/35">
                Nothing here yet. Like, save or watch something and it will appear.
              </p>
            ) : (
              rows.map((row) => (
                <div
                  key={row.slug}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2.5"
                >
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-panel2">
                    {row.thumb ? (
                      <img src={imgSrc(row.thumb)} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white/85">{prettyTitle(row.title)}</p>
                    <p className="truncate text-xs text-white/35">{row.sub}</p>
                  </div>
                  <button
                    type="button"
                    data-nav
                    onClick={row.remove}
                    className="btn-ghost !p-2 text-white/40 hover:text-brand"
                    aria-label={`Remove ${row.title} from memory`}
                  >
                    <TrashIcon width={17} height={17} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" data-nav onClick={() => memory.exportMemory()} className="btn-soft !py-2 text-sm">
              <DownloadIcon width={16} height={16} /> Export memory
            </button>
            <button
              type="button"
              data-nav
              onClick={reset}
              disabled={busy}
              className={`btn-soft !py-2 text-sm ${
                confirmReset ? '!border-brand !bg-brand/15 !text-brand-soft' : '!text-white/60'
              }`}
            >
              <TrashIcon width={16} height={16} />
              {confirmReset ? 'Tap again to erase everything' : 'Reset memory'}
            </button>
          </div>
        </section>

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-white/40">System</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-white/40">AI</dt>
              <dd className="text-right font-medium text-white/85">
                {health?.ai.configured ? `${aiProviderLabel(health.ai.provider)} · ${health.ai.model}` : 'Not configured (local picks)'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/40">Catalog</dt>
              <dd className="text-right font-medium text-white/85">{health?.catalog.base || 'checking…'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/40">Posters</dt>
              <dd className="text-right font-medium text-white/85">
                {health?.tmdb.configured ? 'TMDB enrichment enabled' : 'CircleFTP posters'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/40">Playback</dt>
              <dd className="text-right font-medium text-white/85">
                {streamMode === 'direct' ? 'Direct streaming in app' : 'Opens in CircleFTP (HTTPS page)'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/40">Open on TV</dt>
              <dd className="text-right font-mono text-xs text-gold/90">{window.location.origin}</dd>
            </div>
          </dl>
          {streamMode === 'external' ? (
            <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200/80 ring-1 ring-amber-300/20">
              This page is served over HTTPS. CircleFTP only supports HTTP, so in-app playback is blocked by the
              browser. For the full in-app player, run the server on your home network and open its HTTP address on
              the TV.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-2.5 text-sm font-bold uppercase tracking-widest text-white/40">Remote shortcuts</h3>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-xs text-white/50">
            <span><b className="text-white/80">Arrows</b> — move focus</span>
            <span><b className="text-white/80">OK / Enter</b> — select</span>
            <span><b className="text-white/80">Back / Esc</b> — go back</span>
            <span><b className="text-white/80">Mic</b> — speak a request</span>
            <span><b className="text-white/80">←/→ in player</b> — seek 10s</span>
            <span><b className="text-white/80">Space / OK</b> — play-pause</span>
            <span><b className="text-white/80">A</b> — audio tracks</span>
            <span><b className="text-white/80">F</b> — fullscreen</span>
          </div>
        </section>

        <div className="mt-5 flex items-center justify-between text-[0.7rem] text-white/25">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon width={12} height={12} /> Memory persists across restarts
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HeartIcon width={12} height={12} /> <BookmarkIcon width={12} height={12} />
            <ThumbDownIcon width={12} height={12} /> Built for your taste
          </span>
        </div>
      </aside>
    </div>
  )
}
