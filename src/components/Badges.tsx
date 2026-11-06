import type { AudioInfo } from '../types'

export function QualityBadge({ quality }: { quality?: string }) {
  if (!quality) return null
  return (
    <span className="badge bg-black/70 text-white/85 ring-1 ring-white/20">{quality}</span>
  )
}

export function HindiBadge({ audio }: { audio?: AudioInfo | null }) {
  if (!audio) return null
  if (audio.hindi) {
    return (
      <span className="badge bg-emerald-500/90 text-emerald-950" title={`Audio: ${audio.label}`}>
        Hindi
      </span>
    )
  }
  if (audio.verified) {
    return (
      <span className="badge bg-black/70 text-white/70 ring-1 ring-white/15" title={`Audio: ${audio.label}`}>
        {audio.languages.slice(0, 2).join(' · ') || 'Audio'}
      </span>
    )
  }
  return null
}

export function ImdbBadge({ rating }: { rating?: number | null }) {
  if (!rating) return null
  return (
    <span className="badge bg-gold/95 text-black">
      IMDb {rating.toFixed(1)}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}
