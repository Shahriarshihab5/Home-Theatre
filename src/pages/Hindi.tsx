import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailModal } from '../components/DetailModal'
import { Row } from '../components/Row'
import { FilmIcon, TvIcon } from '../components/icons'
import { api } from '../lib/api'
import { focusFirst } from '../lib/nav'
import { useMemory } from '../lib/memory'
import type { CatalogItem } from '../types'

function rankForTaste(items: CatalogItem[], taste: { genres: Record<string, number>; countries: Record<string, number> }) {
  if (!Object.keys(taste.genres).length && !Object.keys(taste.countries).length) return items
  const score = (item: CatalogItem) => {
    let value = 0
    for (const genre of item.genres || []) value += taste.genres[genre] || 0
    if (item.country) value += (taste.countries[item.country] || 0) * 0.8
    return value
  }
  return [...items].sort((a, b) => score(b) - score(a))
}

export function HindiPage() {
  const navigate = useNavigate()
  const memory = useMemory()
  const [data, setData] = useState<{ movies: CatalogItem[]; series: CatalogItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CatalogItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.hindi())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Hindi titles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    focusFirst('[data-nav]')
  }, [load])

  const total = (data?.movies.length || 0) + (data?.series.length || 0)

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Curated by language</p>
        <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-black tracking-tight md:text-3xl">
          <FilmIcon width={26} height={26} className="text-gold" />
          Hindi
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-white/45">
          Titles whose stream filename explicitly lists Hindi audio. Movies and web series are split
          automatically; if audio isn’t listed for a title, it is not included here.
        </p>
      </div>

      {loading ? (
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, row) => (
            <div key={row}>
              <div className="shimmer mb-3 h-5 w-40 rounded" />
              <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="shimmer aspect-[2/3] w-[168px] shrink-0 rounded-2xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-6">
          <p className="font-semibold text-amber-200">Couldn’t load Hindi titles</p>
          <p className="mt-1 text-sm text-white/55">{error}</p>
          <button type="button" data-nav onClick={() => void load()} className="btn-soft mt-4 !py-2 text-sm">
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center">
          <p className="text-lg font-semibold text-white/80">Still scanning the catalog</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-white/40">
            Hindi audio labels are confirmed from each title’s stream filename. The server is scanning in the
            background — this page fills in as soon as titles are verified. Try again in a minute.
          </p>
          <button type="button" data-nav onClick={() => void load()} className="btn-primary mt-5">
            Refresh
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center gap-2 px-1">
              <FilmIcon width={18} height={18} className="text-gold" />
              <h2 className="text-lg font-bold">Hindi Movies</h2>
              <span className="text-xs text-white/35">{data?.movies.length || 0}</span>
            </div>
            {data?.movies.length ? (
              <Row title="" items={rankForTaste(data.movies, memory.taste)} onSelect={setSelected} accent="gold" />
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-white/35">
                No Hindi movies confirmed yet.
              </p>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2 px-1">
              <TvIcon width={18} height={18} className="text-gold" />
              <h2 className="text-lg font-bold">Hindi Web Series</h2>
              <span className="text-xs text-white/35">{data?.series.length || 0}</span>
            </div>
            {data?.series.length ? (
              <Row title="" items={rankForTaste(data.series, memory.taste)} onSelect={setSelected} accent="gold" />
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-white/35">
                No Hindi web series confirmed yet.
              </p>
            )}
          </section>
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
