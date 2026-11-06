import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailModal } from '../components/DetailModal'
import { PosterCard } from '../components/PosterCard'
import { BookmarkIcon, TrashIcon } from '../components/icons'
import { useMemory } from '../lib/memory'
import type { CatalogItem } from '../types'

export function WatchlistPage() {
  const memory = useMemory()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const list = memory.watchlist

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">
          Memory · {memory.profileName}
        </p>
        <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-black tracking-tight md:text-3xl">
          <BookmarkIcon width={26} height={26} className="text-gold" />
          Watch later
        </h1>
        <p className="mt-1 text-sm text-white/45">
          {list.length
            ? `${list.length} saved title${list.length === 1 ? '' : 's'} for this profile.`
            : 'Save anything with the Wishlist button and it will wait here.'}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center">
          <p className="text-lg font-semibold text-white/80">Your wishlist is empty</p>
          <p className="mt-1 text-sm text-white/40">
            Open any title and press <b className="text-white/70">Watchlist</b> to save it for later.
          </p>
          <button type="button" data-nav onClick={() => navigate('/')} className="btn-primary mt-5">
            Find something to save
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {list.map((item) => (
            <div key={item.slug} className="rounded-2xl border border-white/10 bg-white/[0.02] p-2">
              <PosterCard item={item} onSelect={setSelected} widthClass="w-full" />
              <div className="mt-2 flex items-center justify-between gap-1">
                <span className="truncate text-[0.65rem] text-white/30">
                  {new Date(item.addedAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  data-nav
                  onClick={() => memory.removeWatchlist(item.slug)}
                  className="rounded-lg p-1.5 text-white/35 transition hover:bg-white/[0.08] hover:text-brand-soft"
                  title="Remove from wishlist"
                  aria-label={`Remove ${item.title}`}
                >
                  <TrashIcon width={15} height={15} />
                </button>
              </div>
            </div>
          ))}
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
