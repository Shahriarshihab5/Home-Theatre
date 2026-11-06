import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailModal } from '../components/DetailModal'
import { ProgressBar } from '../components/Badges'
import { HistoryIcon, PlayIcon, TrashIcon } from '../components/icons'
import { imgSrc, prettyTitle } from '../lib/api'
import { useMemory } from '../lib/memory'
import type { CatalogItem } from '../types'

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

export function HistoryPage() {
  const memory = useMemory()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<CatalogItem | null>(null)

  const list = memory.history

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">
            Memory · {memory.profileName}
          </p>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-black tracking-tight md:text-3xl">
            <HistoryIcon width={26} height={26} className="text-gold" />
            Watch history
          </h1>
          <p className="mt-1 text-sm text-white/45">
            {list.length
              ? `${list.length} title${list.length === 1 ? '' : 's'} watched or started on this profile.`
              : 'Titles you play will appear here automatically.'}
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center">
          <p className="text-lg font-semibold text-white/80">Nothing watched yet</p>
          <p className="mt-1 text-sm text-white/40">
            Start a movie and it will be remembered here — including where you stopped.
          </p>
          <button type="button" data-nav onClick={() => navigate('/')} className="btn-primary mt-5">
            Browse the catalog
          </button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {list.map((entry) => {
            const pct = entry.durationSec ? Math.min(1, entry.positionSec / entry.durationSec) : 0
            return (
              <div
                key={entry.slug}
                className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                <button
                  type="button"
                  data-nav
                  onClick={() => setSelected(entry)}
                  className="h-[126px] w-[84px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-panel2"
                  aria-label={`Details for ${entry.title}`}
                >
                  {entry.thumb ? (
                    <img src={imgSrc(entry.thumb)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl text-white/20">🎬</span>
                  )}
                </button>

                <div className="flex min-w-0 flex-1 flex-col">
                  <button
                    type="button"
                    data-nav
                    onClick={() => setSelected(entry)}
                    className="truncate text-left text-[0.95rem] font-bold text-white/90 hover:text-white"
                  >
                    {prettyTitle(entry.title)}
                  </button>

                  <p className="mt-0.5 text-[0.72rem] text-white/35">
                    {entry.completed
                      ? 'Finished'
                      : pct > 0
                        ? `${Math.round(pct * 100)}% · ${fmtTime(entry.positionSec)}`
                        : 'Started'}
                    {' · '}
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </p>

                  {pct > 0 ? (
                    <div className="mt-2">
                      <ProgressBar value={pct} />
                    </div>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                    <button
                      type="button"
                      data-nav
                      onClick={() => navigate(`/watch/${entry.slug}`)}
                      className="btn-primary !px-3 !py-1.5 text-xs"
                    >
                      <PlayIcon width={13} height={13} />
                      {entry.completed ? 'Watch again' : entry.positionSec > 10 ? 'Resume' : 'Play'}
                    </button>
                    <button
                      type="button"
                      data-nav
                      onClick={() => memory.removeHistory(entry.slug)}
                      className="btn-ghost !px-3 !py-1.5 text-xs !text-white/40 hover:!text-brand-soft"
                      title="Remove from history"
                    >
                      <TrashIcon width={14} height={14} /> Remove
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <DetailModal
        item={selected}
        onClose={() => setSelected(null)}
        onFindSimilar={(detail) => {
          setSelected(null)
          navigate(`/?similar=${encodeURIComponent(detail.slug)}`)
        }}
      />
    </main>
  )
}
