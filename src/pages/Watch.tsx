import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, imgSrc, prettyTitle, streamMode } from '../lib/api'
import { useMemory } from '../lib/memory'
import type { Detail } from '../types'
import { HindiBadge, ImdbBadge, QualityBadge } from '../components/Badges'
import { Row } from '../components/Row'
import { DetailModal } from '../components/DetailModal'
import {
  BookmarkIcon,
  CheckIcon,
  ChevronLeft,
  DownloadIcon,
  HeartIcon,
  OpenIcon,
  PlayIcon,
  ThumbDownIcon,
  VolumeIcon,
} from '../components/icons'

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

interface AudioTrackLike {
  id?: string
  label?: string
  language?: string
  enabled: boolean
}

interface TrackCapableVideo extends HTMLVideoElement {
  audioTracks?: { length: number; [index: number]: AudioTrackLike }
  webkitAudioTracks?: { length: number; [index: number]: AudioTrackLike }
}

function getAudioTrackList(video: HTMLVideoElement | null) {
  const v = video as TrackCapableVideo | null
  return v?.audioTracks || v?.webkitAudioTracks || null
}

function describeTrack(track: AudioTrackLike, index: number) {
  const label = track.label?.trim()
  const language = track.language?.trim()
  if (label && language && !label.toLowerCase().includes(language.toLowerCase())) {
    return `${label} (${language})`
  }
  return label || language || `Track ${index + 1}`
}

export function WatchPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const memory = useMemory()

  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [selected, setSelected] = useState<{ slug: string; title: string } | null>(null)
  const [audioOpen, setAudioOpen] = useState(false)
  const [tracks, setTracks] = useState<{ label: string; enabled: boolean }[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const lastSave = useRef(0)
  const resumeApplied = useRef(false)
  const detailRef = useRef<Detail | null>(null)
  const progressRef = useRef({ position: 0, duration: 0 })

  const history = memory.history.find((h) => h.slug === slug)
  const resumeAt = history && !history.completed ? history.positionSec : 0

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setError(null)
    setDetail(null)
    setVideoError(false)
    api
      .detail(slug)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        detailRef.current = d
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [slug])

  // Persist progress on unmount + make sure the perf class never leaks.
  useEffect(() => {
    return () => {
      document.body.classList.remove('video-playing')
      const d = detailRef.current
      const { position, duration } = progressRef.current
      if (d && position > 10) {
        memory.saveProgress(d, position, duration)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const source = detail?.sources?.[0]?.url || ''
  const canPlay = streamMode === 'direct' && Boolean(source)

  const syncAudioTracks = useCallback(() => {
    const list = getAudioTrackList(videoRef.current)
    if (!list || !list.length) {
      setTracks([])
      return
    }
    setTracks(
      Array.from({ length: list.length }, (_, i) => ({
        label: describeTrack(list[i], i),
        enabled: Boolean(list[i].enabled),
      })),
    )
  }, [])

  const chooseAudio = useCallback(
    (index: number) => {
      const video = videoRef.current
      const list = getAudioTrackList(video)
      if (!video || !list || !list.length) return
      const at = video.currentTime
      for (let i = 0; i < list.length; i += 1) {
        list[i].enabled = i === index
      }
      // Keep the viewer at the same moment after the audio pipeline changes.
      video.currentTime = at
      syncAudioTracks()
    },
    [syncAudioTracks],
  )

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    syncAudioTracks()
    if (resumeApplied.current) return
    resumeApplied.current = true
    if (resumeAt > 15 && resumeAt < video.duration - 10) {
      video.currentTime = resumeAt
    }
    video.play().catch(() => {
      /* autoplay may be blocked on TVs — native controls remain usable */
    })
  }, [resumeAt, syncAudioTracks])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    const d = detailRef.current
    if (!video || !d) return
    progressRef.current = { position: video.currentTime, duration: video.duration || 0 }
    const now = Date.now()
    if (now - lastSave.current > 5000) {
      lastSave.current = now
      memory.saveProgress(d, video.currentTime, video.duration || 0)
    }
  }, [memory])

  const onEnded = useCallback(() => {
    const d = detailRef.current
    if (d) memory.markCompleted(d)
  }, [memory])

  const toggleFullscreen = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  const seek = (delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta))
    lastSave.current = 0
  }

  useEffect(() => {
    if (!canPlay) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      const video = videoRef.current
      if (!video) return
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          seek(-10)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(10)
          break
        case 'ArrowUp':
          e.preventDefault()
          video.volume = Math.min(1, video.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          video.volume = Math.max(0, video.volume - 0.1)
          break
        case ' ':
        case 'Enter':
          e.preventDefault()
          if (video.paused) video.play().catch(() => {})
          else video.pause()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'a':
        case 'A':
          e.preventDefault()
          syncAudioTracks()
          setAudioOpen((open) => !open)
          break
        case 'Escape':
        case 'Backspace':
          if (audioOpen) {
            e.preventDefault()
            setAudioOpen(false)
            break
          }
          if (!document.fullscreenElement) {
            e.preventDefault()
            navigate('/')
          }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canPlay, navigate, toggleFullscreen, syncAudioTracks, audioOpen])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">Could not open this title</p>
        <p className="max-w-lg text-sm text-white/50">{error}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate('/')} className="btn-soft">
            <ChevronLeft width={18} height={18} /> Back to home
          </button>
          <button
            type="button"
            onClick={() => window.open(`http://hd.circleftp.net/watch/${slug}.html`, '_blank', 'noopener')}
            className="btn-primary"
          >
            <OpenIcon width={16} height={16} /> Open on CircleFTP
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink">
        <div className="mx-auto flex max-w-[1700px] items-center gap-4 px-4 py-3 md:px-8">
          <button type="button" onClick={() => navigate('/')} className="btn-ghost !py-2">
            <ChevronLeft width={20} height={20} /> Home
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white/85">{detail ? prettyTitle(detail.title) : 'Loading…'}</p>
            <p className="truncate text-[0.65rem] text-white/35">
              {detail ? [detail.year, detail.quality, detail.audio?.label].filter(Boolean).join(' · ') : ' '}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="ml-auto text-xs text-white/35 hover:text-white/70"
          >
            {streamMode === 'direct' ? 'Direct stream' : 'External playback'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 md:px-8">
        {!detail ? (
          <div className="grid gap-6 md:grid-cols-[240px_1fr]">
            <div className="shimmer aspect-[2/3] w-full max-w-[240px] rounded-2xl" />
            <div className="space-y-3">
              <div className="shimmer h-8 w-2/3 rounded" />
              <div className="shimmer h-4 w-1/3 rounded" />
              <div className="shimmer aspect-video w-full rounded-2xl" />
            </div>
          </div>
        ) : (
          <>
            <div ref={boxRef} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              {canPlay && !videoError ? (
                <video
                  ref={videoRef}
                  src={source}
                  poster={imgSrc(detail.thumb)}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full bg-black"
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={onTimeUpdate}
                  onPlay={() => {
                    document.body.classList.add('video-playing')
                    syncAudioTracks()
                  }}
                  onPause={() => {
                    document.body.classList.remove('video-playing')
                    const v = videoRef.current
                    if (v && detail) memory.saveProgress(detail, v.currentTime, v.duration || 0)
                  }}
                  onEnded={onEnded}
                  onError={() => setVideoError(true)}
                />
              ) : (
                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
                  {detail.thumb ? (
                    <img src={imgSrc(detail.thumb)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20" />
                  ) : null}
                  <div className="relative max-w-xl p-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                      <PlayIcon width={26} height={26} className="text-white" />
                    </div>
                    <p className="text-lg font-bold">
                      {streamMode === 'external'
                        ? 'This page is HTTPS — CircleFTP streams are HTTP'
                        : videoError
                          ? 'Your TV browser could not decode this file'
                          : 'No direct stream listed for this title'}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-white/50">
                      {streamMode === 'external'
                        ? 'Because browsers block HTTP video inside HTTPS pages, play opens on CircleFTP itself. For in-app playback with resume, run the app on your home network over HTTP.'
                        : videoError
                          ? 'The file may be an unsupported container/codec (often MKV). Open it on CircleFTP, or try the TV’s native video player app.'
                          : 'CircleFTP didn’t expose a source for this title. Open its page to use the site’s own player.'}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.open(detail.watchUrl, '_blank', 'noopener')}
                        className="btn-primary"
                      >
                        <OpenIcon width={16} height={16} /> Open CircleFTP player
                      </button>
                      {source ? (
                        <button
                          type="button"
                          onClick={() => window.open(source, '_blank', 'noopener')}
                          className="btn-soft"
                        >
                          Open direct stream
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {canPlay && !videoError ? (
                <button type="button" onClick={() => seek(0)} className="btn-soft !py-2 text-sm">
                  <PlayIcon width={15} height={15} /> Restart
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => memory.toggleWatchlist(detail)}
                className={`btn-soft !py-2 text-sm ${memory.watchlist.some((w) => w.slug === detail.slug) ? '!border-gold/60 !text-gold' : ''}`}
              >
                <BookmarkIcon width={16} height={16} />{' '}
                {memory.watchlist.some((w) => w.slug === detail.slug) ? 'In Watchlist' : 'Watchlist'}
              </button>
              <button
                type="button"
                onClick={() => memory.rate(detail, memory.ratings[detail.slug]?.value === 'like' ? null : 'like')}
                className={`btn-soft !py-2 text-sm ${memory.ratings[detail.slug]?.value === 'like' ? '!border-brand/70 !text-brand-soft' : ''}`}
              >
                <HeartIcon width={16} height={16} filled={memory.ratings[detail.slug]?.value === 'like'} /> Like
              </button>
              <button
                type="button"
                onClick={() => memory.rate(detail, memory.ratings[detail.slug]?.value === 'dislike' ? null : 'dislike')}
                className="btn-soft !py-2 text-sm"
              >
                <ThumbDownIcon width={16} height={16} filled={memory.ratings[detail.slug]?.value === 'dislike'} />
              </button>
              <button type="button" onClick={() => memory.markCompleted(detail)} className="btn-soft !py-2 text-sm">
                <CheckIcon width={16} height={16} /> Mark watched
              </button>
              <button
                type="button"
                onClick={() => window.open(detail.watchUrl, '_blank', 'noopener')}
                className="btn-ghost !py-2 text-sm"
              >
                <OpenIcon width={15} height={15} /> CircleFTP
              </button>
              {detail.downloadUrl ? (
                <button
                  type="button"
                  onClick={() => window.open(detail.downloadUrl, '_blank', 'noopener')}
                  className="btn-ghost !py-2 text-sm"
                >
                  <DownloadIcon width={15} height={15} /> Download
                </button>
              ) : null}
              <button type="button" onClick={toggleFullscreen} className="btn-ghost !py-2 text-sm">
                Fullscreen
              </button>
              <button
                type="button"
                onClick={() => {
                  syncAudioTracks()
                  setAudioOpen((open) => !open)
                }}
                className={`btn-ghost !py-2 text-sm ${audioOpen ? '!text-gold' : ''}`}
                aria-expanded={audioOpen}
              >
                <VolumeIcon width={15} height={15} /> Audio
                {tracks.length > 1 ? (
                  <span className="max-w-[9rem] truncate text-[0.7rem] text-white/35">
                    {tracks.find((t) => t.enabled)?.label || ''}
                  </span>
                ) : null}
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-white/30">
                <VolumeIcon width={14} height={14} /> ←/→ seek · ↑/↓ volume · Space pause · A audio
              </span>
            </div>

            {audioOpen ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/40">Audio track</p>
                  <p className="text-[0.65rem] text-white/30">
                    Source: {detail.audio?.label || 'not listed'}
                  </p>
                </div>

                {tracks.length > 1 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tracks.map((track, index) => (
                      <button
                        key={`${track.label}-${index}`}
                        type="button"
                        onClick={() => chooseAudio(index)}
                        className={`chip !text-sm ${
                          track.enabled ? '!border-gold !bg-gold/15 !text-gold' : ''
                        }`}
                      >
                        {track.enabled ? <CheckIcon width={14} height={14} /> : null}
                        {track.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-white/65">
                      {tracks.length === 1
                        ? `The browser exposes one track: ${tracks[0].label}.`
                        : 'This TV browser is not exposing the embedded MKV audio tracks.'}
                    </p>
                    <p className="text-xs leading-relaxed text-white/40">
                      CircleFTP stores these as one MKV with dual audio (for example Hindi + Korean).
                      Chrome-based TV browsers usually play only the default track and cannot switch
                      it. If your TV browser shows a track menu in its own player, use that; otherwise
                      open the file in VLC or CircleFTP’s player on a device that supports MKV audio
                      tracks.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => window.open(detail.watchUrl, '_blank', 'noopener')}
                        className="btn-soft !py-2 text-sm"
                      >
                        <OpenIcon width={15} height={15} /> Open CircleFTP player
                      </button>
                      {source ? (
                        <button
                          type="button"
                          onClick={() => window.open(source, '_blank', 'noopener')}
                          className="btn-soft !py-2 text-sm"
                        >
                          <PlayIcon width={15} height={15} /> Open in TV video player
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]">
              <div className="hidden md:block">
                {detail.thumb ? (
                  <img
                    src={imgSrc(detail.thumb)}
                    alt={detail.title}
                    className="aspect-[2/3] w-full rounded-2xl border border-white/10 object-cover"
                  />
                ) : null}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <QualityBadge quality={detail.quality} />
                  <HindiBadge audio={detail.audio} />
                  <ImdbBadge rating={detail.imdbRating} />
                  {detail.genres.map((g) => (
                    <span key={g} className="badge bg-white/10 text-white/65">
                      {g}
                    </span>
                  ))}
                </div>

                <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">{prettyTitle(detail.title)}</h1>
                <p className="mt-1 text-sm text-white/45">
                  {[detail.year, detail.duration, detail.country, detail.releaseDate].filter(Boolean).join(' · ')}
                </p>
                {detail.description ? (
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">{detail.description}</p>
                ) : null}

                <div className="mt-4 space-y-1.5 text-xs text-white/40">
                  <p>
                    <span className="text-white/60">Audio:</span> {detail.audio?.label || 'not listed'}
                    {detail.audio?.verified
                      ? ' · read from the source filename'
                      : ' · not listed by the source, confirm in the player'}
                  </p>
                  {history?.positionSec ? (
                    <p>
                      <span className="text-white/60">Progress:</span> {fmt(history.positionSec)}
                      {history.durationSec ? ` / ${fmt(history.durationSec)}` : ''}
                      {history.completed ? ' · finished' : ' · saved automatically'}
                    </p>
                  ) : null}
                  <p>Streaming directly from CircleFTP’s file server — no video is routed through this app.</p>
                </div>

                {detail.altServers.length > 1 ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/35">Servers / episodes</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.altServers.map((s) => (
                        <button
                          key={s.label + s.url}
                          type="button"
                          onClick={() => window.open(s.url, '_blank', 'noopener')}
                          className="chip !px-3 !py-1.5 text-xs"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-8">
              <Row
                title="More like this"
                items={detail.related}
                onSelect={(item) => setSelected({ slug: item.slug, title: item.title })}
                accent="none"
              />
            </div>
          </>
        )}
      </main>

      <DetailModal
        item={selected ? ({ ...selected } as Detail) : null}
        onClose={() => setSelected(null)}
        onFindSimilar={() => navigate('/')}
      />
    </div>
  )
}
