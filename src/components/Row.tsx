import { useRef, type ReactNode } from 'react'
import type { CatalogItem } from '../types'
import { ChevronLeft, ChevronRight } from './icons'
import { PosterCard } from './PosterCard'

interface RowProps {
  title: string
  items: CatalogItem[]
  note?: string
  subtitleFor?: (item: CatalogItem) => string | undefined
  progressFor?: (item: CatalogItem) => number | undefined
  onSelect: (item: CatalogItem) => void
  renderItem?: (item: CatalogItem) => ReactNode
  accent?: 'brand' | 'gold' | 'none'
}

export function Row({ title, items, note, subtitleFor, progressFor, onSelect, renderItem, accent = 'brand' }: RowProps) {
  const scroller = useRef<HTMLDivElement>(null)

  if (!items.length) return null

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.7), behavior: 'auto' })
  }

  return (
    <section className="group/row relative row-section">
      {title ? (
        <div className="mb-3 flex items-end justify-between gap-4 px-1">
          <div className="flex items-baseline gap-3">
            <h2 className="flex items-center gap-2.5 text-[1.15rem] font-bold tracking-tight text-white/95">
              <span
                className={`inline-block h-5 w-1 rounded-full ${
                  accent === 'gold' ? 'bg-gold' : accent === 'none' ? 'bg-white/30' : 'bg-brand'
                }`}
              />
              {title}
            </h2>
            {note ? <p className="hidden max-w-2xl truncate text-xs text-white/40 md:block">{note}</p> : null}
          </div>

          <div className="hidden gap-2 opacity-0 transition group-hover/row:opacity-100 md:flex">
            <button type="button" onClick={() => nudge(-1)} className="btn-ghost !p-2" aria-label={`Scroll ${title} left`}>
              <ChevronLeft width={18} height={18} />
            </button>
            <button type="button" onClick={() => nudge(1)} className="btn-ghost !p-2" aria-label={`Scroll ${title} right`}>
              <ChevronRight width={18} height={18} />
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-1"
      >
        {items.map((item) =>
          renderItem ? (
            <div key={item.slug} className="shrink-0 snap-start">
              {renderItem(item)}
            </div>
          ) : (
            <PosterCard
              key={item.slug}
              item={item}
              progress={progressFor?.(item)}
              subtitle={subtitleFor?.(item)}
              onSelect={onSelect}
            />
          ),
        )}
      </div>
    </section>
  )
}
