import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, imgSrc, prettyTitle, streamMode } from '../lib/api'
import { useMemory } from '../lib/memory'
import { focusFirst } from '../lib/nav'
import type { CatalogItem, Detail } from '../types'
import { HindiBadge, ImdbBadge, QualityBadge } from './Badges'
import {
  BookmarkIcon,
  CheckIcon,
  DownloadIcon,
  HeartIcon,
  OpenIcon,
  PlayIcon,
  SparkIcon,
  ThumbDownIcon,
  XIcon,
} from './icons'
import { PosterCard } from './PosterCard'

interface DetailModalProps {
  item: CatalogItem | null
  onClose: () => void
  onFindSimilar: (detail: Detail) => void
}

export function DetailModal({ item, onClose, onFindSimilar }: DetailModalProps) {
  const navigate = useNavigate()
  const memory = useMemory()

  const [slug, setSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSlug(item?.slug || null)
    setDetail(null)
    setError(null)
    if (item) {
      setLoading(true)
      api
        .detail(item.slug)
        .then((d) => setDetail(d))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [item])

  const open = Boolean(item)

  useEffect(() => {
    if (!open) return
    document.body.classList.add('modal-open')
    const onBack = () => onClose()
    document.addEventListener('tv-back', onBack)
    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('tv-back', onBack)
    }
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: 0 })
      focusFirst('[data-modal="true"] [data-nav]')
    }
  }, [open, detail?.slug])

  const selectRelated = useCallback((next: CatalogItem) => {
    setSlug(next.slug)
    setDetail(null)
    setError(null)
    setLoading(true)
    api
      .detail(next.slug)
      .then((d) => setDetail(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (!open) return null

  const current = detail
  const rating = slug ? memory.ratings[slug]?.value : undefined
  const inWatchlist = Boolean(slug && memory.watchlist.some((w) => w.slug === slug))
  const historyEntry = slug ? memory.history.find((h) => h.slug === slug) : undefined
  const resume = historyEntry && !historyEntry.completed && historyEntry.positionSec > 15 ? historyEntry : null

  const play = () => {
    if (!slug) return
    if (streamMode === 'direct') {
      navigate(`/watch/${slug}`)
    } else {
      window.open(current?.watchUrl || `http://hd.circleftp.net/watch/${slug}.html`, '_blank', 'noopener')
    }
  }

  const rateTarget = current
    ? {
        slug: current.slug,
        title: current.title,
        thumb: current.thumb,
        quality: current.quality,
        genres: current.genres,
        country: current.country,
      }
    : null

  return (
    <div
      data-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 p-3 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={scrollRef}
        className="relative my-auto w-full max-w-6xl animate-pop overflow-hidden rounded-3xl border border-white/10 bg-panel shadow-2xl"
      >
        <button
          type="button"
          data-nav
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white/80 ring-1 ring-white/20 transition hover:bg-black/80 hover:text-white"
          aria-label="Close details"
        >
          <XIcon width={20} height={20} />
        </button>

        {loading && !current ? (
          <div className="grid gap-6 p-6 md:grid-cols-[260px_1fr] md:p-8">
            <div className="shimmer aspect-[2/3] w-full max-w-[260px] rounded-2xl" />
            <div className="space-y-4 pt-4">
              <div className="shimmer h-8 w-2/3 rounded" />
              <div className="shimmer h-4 w-1/3 rounded" />
              <div className="shimmer h-24 w-full rounded" />
              <div className="shimmer h-10 w-64 rounded" />
            </div>
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="mb-2 text-lg font-semibold">Could not load this title</p>
            <p className="mb-6 text-sm text-white/50">{error}</p>
            <button data-nav type="button" onClick={onClose} className="btn-soft">
              Back
            </button>
          </div>
        ) : current ? (
          <>
            <div className="relative">
              <div
                className="absolute inset-0 opacity-40 blur-2xl"
                style={{
                  backgroundImage: `url(${imgSrc(current.thumb)})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center 20%',
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/80 to-transparent" />

              <div className="relative grid gap-6 p-5 md:grid-cols-[250px_1fr] md:p-8">
                <div className="mx-auto w-[190px] md:mx-0 md:w-full">
                  {current.thumb ? (
                    <img
                      src={imgSrc(current.thumb)}
                      alt={current.title}
                      className="aspect-[2/3] w-full rounded-2xl border border-white/15 object-cover shadow-2xl"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] w-full items-center justify-center rounded-2xl border border-white/15 bg-panel2 text-4xl font-black text-white/20">
                      🎬
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <QualityBadge quality={current.quality} />
                    <HindiBadge audio={current.audio} />
                    <ImdbBadge rating={current.imdbRating} />
                    {current.genres.map((g) => (
                      <span key={g} className="badge bg-white/10 text-white/70">
                        {g}
                      </span>
                    ))}
                  </div>

                  <h1 className="text-2xl font-black leading-tight tracking-tight md:text-4xl">{prettyTitle(current.title)}</h1>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
                    {current.year ? <span>{current.year}</span> : null}
                    {current.duration ? <span>{current.duration}</span> : null}
                    {current.country ? <span>{current.country}</span> : null}
                    <span className="text-white/25">•</span>
                    <span className="text-emerald-400/80">Verified on CircleFTP</span>
                  </div>

                  {current.description ? (
                    <p className="mt-4 line-clamp-4 max-w-3xl text-sm leading-relaxed text-white/75 md:text-[0.95rem]">
                      {current.description}
                    </p>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-2.5">
                    <button type="button" data-nav onClick={play} className="btn-primary !px-7">
                      <PlayIcon width={18} height={18} />
                      {resume ? `Resume ${Math.floor(resume.positionSec / 60)}m` : 'Play now'}
                    </button>

                    <button
                      type="button"
                      data-nav
                      onClick={() =>
                        rateTarget &&
                        memory.toggleWatchlist(rateTarget)
                      }
                      className={`btn-soft ${inWatchlist ? '!border-gold/60 !text-gold' : ''}`}
                    >
                      <BookmarkIcon width={18} height={18} filled={inWatchlist} />
                      {inWatchlist ? 'In Watchlist' : 'Watchlist'}
                    </button>

                    <button
                      type="button"
                      data-nav
                      onClick={() =>
                        rateTarget && memory.rate(rateTarget, rating === 'like' ? null : 'like')
                      }
                      className={`btn-soft ${rating === 'like' ? '!border-brand/70 !text-brand-soft' : ''}`}
                      title="Like — tunes your recommendations"
                    >
                      <HeartIcon width={18} height={18} filled={rating === 'like'} />
                      Like
                    </button>

                    <button
                      type="button"
                      data-nav
                      onClick={() =>
                        rateTarget && memory.rate(rateTarget, rating === 'dislike' ? null : 'dislike')
                      }
                      className={`btn-soft ${rating === 'dislike' ? '!border-white/60 !text-white' : ''}`}
                      title="Dislike — tunes your recommendations"
                    >
                      <ThumbDownIcon width={18} height={18} filled={rating === 'dislike'} />
                    </button>

                    {rateTarget ? (
                      <button
                        type="button"
                        data-nav
                        onClick={() => memory.markCompleted(rateTarget)}
                        className={`btn-soft ${historyEntry?.completed ? '!border-emerald-400/60 !text-emerald-300' : ''}`}
                        title="Mark as watched"
                      >
                        <CheckIcon width={18} height={18} />
                        {historyEntry?.completed ? 'Watched' : 'Mark watched'}
                      </button>
                    ) : null}

                    <button type="button" data-nav onClick={() => onFindSimilar(current)} className="btn-soft">
                      <SparkIcon width={18} height={18} className="text-gold" />
                      Find similar
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/45">
                    <span>
                      Audio: <span className="text-white/70">{current.audio?.label || 'not listed'}</span>
                      {current.audio?.verified ? (
                        <span className="ml-1.5 text-emerald-400/80">• from source filename</span>
                      ) : (
                        <span className="ml-1.5 text-amber-300/80">• confirm in player</span>
                      )}
                    </span>
                    {current.altServers.length > 0 ? (
                      <span>
                        Servers / episodes listed: <span className="text-white/70">{current.altServers.length}</span>
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-nav
                      onClick={() => window.open(current.watchUrl, '_blank', 'noopener')}
                      className="inline-flex items-center gap-1 text-white/45 underline-offset-2 hover:text-white/80 hover:underline"
                    >
                      <OpenIcon width={13} height={13} /> CircleFTP page
                    </button>
                    {current.downloadUrl ? (
                      <button
                        type="button"
                        data-nav
                        onClick={() => window.open(current.downloadUrl, '_blank', 'noopener')}
                        className="inline-flex items-center gap-1 text-white/45 underline-offset-2 hover:text-white/80 hover:underline"
                      >
                        <DownloadIcon width={13} height={13} /> Download link
                      </button>
                    ) : null}
                  </div>

                  {current.altServers.length > 1 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {current.altServers.map((s) => (
                        <button
                          key={s.label + s.url}
                          type="button"
                          data-nav
                          onClick={() => window.open(s.url, '_blank', 'noopener')}
                          className="chip !px-3 !py-1.5 text-xs"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {current.related.length ? (
              <div className="border-t border-white/10 px-5 py-5 md:px-8">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-white/40">You may also like</h3>
                <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
                  {current.related.map((rel) => (
                    <PosterCard
                      key={rel.slug}
                      item={rel}
                      onSelect={selectRelated}
                      widthClass="w-[120px] md:w-[132px]"
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
