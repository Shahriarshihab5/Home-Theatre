import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, imgSrc, playUrl, prettyTitle, streamMode } from '../lib/api'
import { useMemory } from '../lib/memory'
import type { Detail, StreamInfo } from '../types'
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
  PauseIcon,
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

/** Pick the audio track the viewer expects: Hindi if the file offers it. */
function defaultAudioOrdinal(info: StreamInfo | null): number {
  const list = info?.info?.audio || []
  if (!list.length) return 0
  if (info?.filenameAudio?.hindi) {
    const hindi = list.find((t) => t.lang === 'hin' || /hindi/i.test(t.language))
    if (hindi) return hindi.ordinal
  }
  return list.find((t) => t.isDefault)?.ordinal ?? 0
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

  // Browser-friendly stream state (ffmpeg remux + real audio tracks)
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null)
  const [audioOrdinal, setAudioOrdinal] = useState(0)
  const [baseOffset, setBaseOffset] = useState(0)
  const [streamKey, setStreamKey] = useState(0)
  const [silent, setSilent] = useState(false)
  // Custom timeline. The remuxed stream has no seekable index, so the browser's
  // own progress bar only ever shows the few seconds ffmpeg has produced. We use
  // the real duration from /api/stream-info and restart ffmpeg at the target.
  const [position, setPosition] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [paused, setPaused] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const lastSave = useRef(0)
  const resumeApplied = useRef(false)
  const detailRef = useRef<Detail | null>(null)
  const progressRef = useRef({ position: 0, duration: 0 })
  const silentTimer = useRef<number | null>(null)
  const audioPicked = useRef(false)
  const seekTimer = useRef<number | null>(null)

  const history = memory.history.find((h) => h.slug === slug)
  const resumeAt = history && !history.completed ? history.positionSec : 0

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setError(null)
    setDetail(null)
    setVideoError(false)
    setStreamInfo(null)
    setSilent(false)
    setAudioOrdinal(0)
    setBaseOffset(0)
    setPosition(0)
    setSeeking(false)
    audioPicked.current = false
    api
      .detail(slug)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        detailRef.current = d
      })
      .catch((e) => !cancelled && setError(e.message))
    api
      .streamInfo(slug)
      .then((info) => {
        if (cancelled) return
        setStreamInfo(info)
        // Don't undo a track the viewer already picked while this was loading.
        if (!audioPicked.current) setAudioOrdinal(defaultAudioOrdinal(info))
      })
      .catch(() => {})
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
  const realTracks = streamInfo?.info?.audio || []
  // ffmpeg on the server re-muxes the video and converts audio to AAC, so the
  // browser gets sound and can switch languages.
  const canRemux = Boolean(streamInfo?.transcode && streamInfo?.source)
  const playingRemux = canRemux
  const canPlay = Boolean(detail) && (playingRemux || (streamMode === 'direct' && Boolean(source)))
  const videoSrc = playingRemux && detail
    ? playUrl(detail.slug, audioOrdinal, baseOffset)
    : source

  const currentTrack = realTracks.find((t) => t.ordinal === audioOrdinal) || realTracks[0] || null
  const totalDuration = streamInfo?.info?.durationSec || 0
  const absoluteTime = () => baseOffset + (videoRef.current?.currentTime || 0)

  const restartAt = useCallback((seconds: number) => {
    setSeeking(true)
    setPosition(Math.max(0, Math.floor(seconds)))
    setBaseOffset(Math.max(0, Math.floor(seconds)))
    setStreamKey((k) => k + 1)
    setSilent(false)
  }, [])

  // Resume where the viewer stopped, once we know the saved position.
  useEffect(() => {
    if (resumeApplied.current) return
    if (resumeAt > 15) {
      resumeApplied.current = true
      setBaseOffset(Math.floor(resumeAt))
    }
  }, [resumeAt])

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
      // Real tracks from ffmpeg: restart the remux at the same timestamp with
      // the chosen language. Fall back to the browser's own track API.
      if (realTracks.length > 1) {
        audioPicked.current = true
        restartAt(absoluteTime())
        setAudioOrdinal(index)
        return
      }
      const video = videoRef.current
      const list = getAudioTrackList(video)
      if (!video || !list || !list.length) return
      const at = video.currentTime
      for (let i = 0; i < list.length; i += 1) list[i].enabled = i === index
      video.currentTime = at
      syncAudioTracks()
    },
    [baseOffset, realTracks.length, restartAt, syncAudioTracks],
  )

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  /** Preview the target immediately, then restart the stream after a pause so
   *  dragging the bar doesn't spawn dozens of ffmpeg processes. */
  const queueSeek = useCallback(
    (seconds: number) => {
      const target = Math.max(0, Math.min(totalDuration || Infinity, Math.floor(seconds)))
      setPosition(target)
      if (seekTimer.current) window.clearTimeout(seekTimer.current)
      seekTimer.current = window.setTimeout(() => restartAt(target), 450)
    },
    [restartAt, totalDuration],
  )

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setSeeking(false)
    setPaused(video.paused)
    syncAudioTracks()
    video.play().catch(() => {
      /* autoplay may be blocked on TVs — native controls remain usable */
    })
  }, [syncAudioTracks])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    const d = detailRef.current
    if (!video || !d) return
    const at = baseOffset + video.currentTime
    setPosition(at)
    setPaused(video.paused)
    const duration = totalDuration || baseOffset + (video.duration || 0)
    progressRef.current = { position: at, duration }
    const now = Date.now()
    if (now - lastSave.current > 5000) {
      lastSave.current = now
      memory.saveProgress(d, at, duration)
    }
  }, [baseOffset, memory, totalDuration])

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

  const seek = useCallback(
    (delta: number, absolute?: number) => {
      const v = videoRef.current
      if (!v) return
      const target = Math.max(
        0,
        Math.min(totalDuration || Infinity, absolute ?? absoluteTime() + delta),
      )
      if (playingRemux) restartAt(target)
      else v.currentTime = target
      lastSave.current = 0
    },
    [baseOffset, playingRemux, restartAt, totalDuration],
  )

  // Chrome silently plays AC-3/E-AC3 video with no sound. Detect that honestly.
  const checkSilence = useCallback(() => {
    if (silentTimer.current) window.clearTimeout(silentTimer.current)
    silentTimer.current = window.setTimeout(() => {
      const v = videoRef.current as (HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) | null
      if (!v || v.paused || v.muted || v.volume === 0) return
      const decoded = v.webkitAudioDecodedByteCount
      if (typeof decoded === 'number' && decoded === 0) setSilent(true)
    }, 6000)
  }, [])

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
  }, [canPlay, navigate, toggleFullscreen, syncAudioTracks, audioOpen, seek])

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
                <>
                  <video
                    key={streamKey}
                    ref={videoRef}
                    src={videoSrc}
                    poster={imgSrc(detail.thumb)}
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="aspect-video w-full bg-black"
                    onClick={togglePlay}
                    onLoadedMetadata={onLoadedMetadata}
                    onCanPlay={() => setSeeking(false)}
                    onTimeUpdate={onTimeUpdate}
                    onPlay={() => {
                      setPaused(false)
                      document.body.classList.add('video-playing')
                      syncAudioTracks()
                      checkSilence()
                    }}
                    onPause={() => {
                      setPaused(true)
                      document.body.classList.remove('video-playing')
                      const v = videoRef.current
                      if (v && detail) {
                        memory.saveProgress(detail, baseOffset + v.currentTime, totalDuration || v.duration || 0)
                      }
                    }}
                    onWaiting={() => setBuffering(true)}
                    onPlaying={() => {
                      setBuffering(false)
                      setSeeking(false)
                    }}
                    onEnded={onEnded}
                    onError={() => setVideoError(true)}
                  />

                  {seeking ? (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-black/65">
                      <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-gold" />
                      <p className="text-sm font-semibold text-white/90">Loading from {fmt(position)}…</p>
                      <p className="text-[0.65rem] text-white/40">Restarting the stream at the new position</p>
                    </div>
                  ) : buffering ? (
                    <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full bg-black/65 px-2.5 py-1 text-[0.65rem] text-white/70">
                      <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" /> Buffering
                    </div>
                  ) : null}

                  {!seeking ? (
                    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-2 pt-10">
                      <input
                        type="range"
                        data-nav
                        min={0}
                        max={Math.max(1, Math.floor(totalDuration || 1))}
                        step={60}
                        value={Math.min(Math.floor(position), Math.max(1, Math.floor(totalDuration || 1)))}
                        onChange={(e) => queueSeek(Number(e.target.value))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/30 accent-[#f0c96a]"
                        aria-label="Seek through the movie"
                      />
                      <div className="mt-1 flex items-center gap-1 text-white/85">
                        <button
                          type="button"
                          data-nav
                          onClick={togglePlay}
                          className="rounded-lg p-1.5 hover:bg-white/10"
                          aria-label={paused ? 'Play' : 'Pause'}
                        >
                          {paused ? <PlayIcon width={18} height={18} /> : <PauseIcon width={18} height={18} />}
                        </button>
                        <button
                          type="button"
                          data-nav
                          onClick={() => seek(-600)}
                          className="chip !px-2 !py-1 !text-[0.65rem]"
                        >
                          −10 min
                        </button>
                        <button
                          type="button"
                          data-nav
                          onClick={() => seek(600)}
                          className="chip !px-2 !py-1 !text-[0.65rem]"
                        >
                          +10 min
                        </button>
                        <span className="ml-1 font-mono text-[0.7rem] tabular-nums text-white/70">
                          {fmt(position)} / {fmt(totalDuration)}
                        </span>
                        <span className="ml-auto" />
                        <button
                          type="button"
                          data-nav
                          onClick={() => {
                            const v = videoRef.current
                            if (v) v.muted = !v.muted
                          }}
                          className="rounded-lg p-1.5 hover:bg-white/10"
                          aria-label="Mute or unmute"
                        >
                          <VolumeIcon width={17} height={17} />
                        </button>
                        <button
                          type="button"
                          data-nav
                          onClick={() => {
                            syncAudioTracks()
                            setAudioOpen((open) => !open)
                          }}
                          className="rounded-lg px-2 py-1 text-[0.65rem] font-semibold hover:bg-white/10"
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          data-nav
                          onClick={toggleFullscreen}
                          className="rounded-lg px-2 py-1 text-[0.65rem] font-semibold hover:bg-white/10"
                        >
                          Fullscreen
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
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
                        ? 'Playback needs your home Wi-Fi'
                        : videoError
                          ? 'Your TV browser could not decode this file'
                          : 'No direct stream listed for this title'}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-white/50">
                      {streamMode === 'external'
                        ? 'This cloud copy of the app can browse the catalog and ask the AI from anywhere. Streaming needs your home Wi-Fi: open the app on the home server (http://<your-laptop-ip>:8787) to play with resume and audio switching.'
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

            {silent || (streamInfo?.info?.audioNeedsRemux && !playingRemux) ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3">
                <VolumeIcon width={18} height={18} className="text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-200">
                    No sound? This file’s audio format isn’t supported by the browser
                  </p>
                  <p className="text-xs text-white/55">
                    {streamInfo?.info?.audio?.[0]
                      ? `The file uses ${streamInfo.info.audio[0].codecLabel}, which Chrome cannot decode. `
                      : ''}
                    {streamInfo?.transcode
                      ? 'Reloading with the built-in audio converter fixes this.'
                      : 'Open it in CircleFTP or your TV’s video player, or run the app on the home server so it can convert the audio for you.'}
                  </p>
                </div>
                {streamInfo?.transcode ? (
                  <button
                    type="button"
                    onClick={() => {
                      const at = absoluteTime()
                      restartAt(at)
                    }}
                    className="btn-primary !py-2 text-sm"
                  >
                    <VolumeIcon width={15} height={15} /> Fix sound
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.open(detail.watchUrl, '_blank', 'noopener')}
                    className="btn-soft !py-2 text-sm"
                  >
                    <OpenIcon width={15} height={15} /> Open CircleFTP
                  </button>
                )}
              </div>
            ) : null}

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
                {(realTracks.length > 1 ? currentTrack?.language : tracks.find((t) => t.enabled)?.label) ? (
                  <span className="max-w-[9rem] truncate text-[0.7rem] text-white/35">
                    {realTracks.length > 1
                      ? currentTrack?.language || currentTrack?.lang
                      : tracks.find((t) => t.enabled)?.label || ''}
                  </span>
                ) : null}
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-white/30">
                <VolumeIcon width={14} height={14} /> ←/→ seek · ↑/↓ volume · Space pause · A audio
              </span>
            </div>

            {playingRemux && totalDuration ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[0.65rem] uppercase tracking-wider text-white/25">Jump to</span>
                {[0.25, 0.5, 0.75].map((fraction) => (
                  <button
                    key={fraction}
                    type="button"
                    onClick={() => seek(0, totalDuration * fraction)}
                    className="chip !text-[0.65rem]"
                  >
                    {Math.round(fraction * 100)}%
                  </button>
                ))}
                <span className="text-[0.6rem] text-white/20">
                  Streaming mode — the player reloads at the new position.
                </span>
              </div>
            ) : null}

            {audioOpen ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/40">Audio track</p>
                  <p className="text-[0.65rem] text-white/30">
                    Source: {detail.audio?.label || 'not listed'}
                  </p>
                </div>

                {realTracks.length ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {realTracks.map((track) => {
                        const active = track.ordinal === audioOrdinal
                        return (
                          <button
                            key={track.ordinal}
                            type="button"
                            onClick={() => chooseAudio(track.ordinal)}
                            className={`chip !text-sm ${active ? '!border-gold !bg-gold/15 !text-gold' : ''}`}
                          >
                            {active ? <CheckIcon width={14} height={14} /> : null}
                            {track.language || track.lang || `Track ${track.ordinal + 1}`}
                            <span className="text-[0.65rem] font-normal text-white/35">
                              {track.codecLabel}
                              {track.channels ? ` · ${track.channels}` : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-xs leading-relaxed text-white/40">
                      These are the real audio tracks inside the file. The video is copied untouched
                      and the track you pick is converted to AAC on the fly, so switching languages
                      works in this browser — no VLC needed.
                    </p>
                  </div>
                ) : tracks.length > 1 ? (
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
                      {streamInfo?.info?.audio?.length
                        ? 'Audio conversion is not available on this server.'
                        : 'Could not read the audio tracks of this file.'}
                    </p>
                    <p className="text-xs leading-relaxed text-white/40">
                      CircleFTP stores these as one MKV with dual audio (for example Hindi + Korean).
                      Chrome-based browsers cannot decode AC-3/E-AC3 audio, so the picture plays
                      silently. Opening it in CircleFTP or the TV’s own video player gives you the
                      full track menu.
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
