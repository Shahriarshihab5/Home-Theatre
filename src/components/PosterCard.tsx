import { useState } from 'react'
import { imgSrc, prettyTitle } from '../lib/api'
import type { CatalogItem } from '../types'
import { ProgressBar, QualityBadge } from './Badges'
import { PlayIcon } from './icons'

interface PosterCardProps {
  item: CatalogItem
  progress?: number
  subtitle?: string
  badge?: string
  onSelect: (item: CatalogItem) => void
  widthClass?: string
}

function initials(title: string) {
  return prettyTitle(title)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}

export function PosterCard({ item, progress, subtitle, badge, onSelect, widthClass = 'w-[168px] md:w-[186px]' }: PosterCardProps) {
  const [failed, setFailed] = useState(false)
  const thumb = imgSrc(item.thumb)
  const showImage = thumb && !failed

  return (
    <button
      type="button"
      data-nav
      onClick={() => onSelect(item)}
      className={`poster-btn group relative shrink-0 snap-start text-left ${widthClass}`}
      title={item.title}
    >
      <div className="poster-frame relative aspect-[2/3] overflow-hidden rounded-2xl border border-white/10 bg-panel2">
        {showImage ? (
          <img
            src={thumb}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel2 via-panel to-black">
            <span className="text-3xl font-black tracking-widest text-white/25">{initials(item.title) || '?'}</span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-90" />

        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <QualityBadge quality={item.quality} />
          {item.audioLabel ? (
            <span className="badge bg-emerald-500/90 text-emerald-950">Hindi</span>
          ) : null}
          {item.imdbRating ? <span className="badge bg-gold/95 text-black">IMDb {item.imdbRating.toFixed(1)}</span> : null}
          {badge ? <span className="badge bg-black/70 text-white/90">{badge}</span> : null}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="line-clamp-2 text-[0.85rem] font-semibold leading-snug text-white drop-shadow">
            {prettyTitle(item.title)}
          </p>
          {subtitle ? <p className="mt-0.5 line-clamp-1 text-[0.7rem] text-white/55">{subtitle}</p> : null}
        </div>

        <div className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 ring-1 ring-white/20 transition group-hover:opacity-100 group-focus:opacity-100">
          <PlayIcon width={15} height={15} />
        </div>

        {typeof progress === 'number' && progress > 0 ? (
          <div className="absolute inset-x-2 bottom-1.5">
            <ProgressBar value={progress} />
          </div>
        ) : null}
      </div>
    </button>
  )
}
