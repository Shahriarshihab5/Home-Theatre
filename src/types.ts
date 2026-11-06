export interface CatalogItem {
  slug: string
  title: string
  thumb?: string
  quality?: string
  imdbRating?: number | null
  audioLabel?: string
  genres?: string[]
  country?: string
  audio?: AudioInfo | null
}

export interface AudioInfo {
  languages: string[]
  dual: boolean
  hindi: boolean
  label: string
  verified: boolean
}

export interface Detail extends CatalogItem {
  description?: string
  genres: string[]
  country?: string
  releaseDate?: string
  year?: number | null
  duration?: string
  imdbRating?: number | null
  sources: { url: string; type: string }[]
  altServers: { label: string; url: string }[]
  downloadUrl?: string
  watchUrl: string
  audio: AudioInfo
  related: CatalogItem[]
  itemId?: string
}

export interface Prefs {
  preferHindi: boolean
  familyOnly: boolean
  tts: boolean
}

export interface RatingEntry {
  slug: string
  title: string
  thumb?: string
  value: 'like' | 'dislike'
  genres?: string[]
  country?: string
  at: number
  profile: string
}

export interface WatchlistEntry extends CatalogItem {
  addedAt: number
  genres?: string[]
  country?: string
  profile: string
}

export interface HistoryEntry extends CatalogItem {
  positionSec: number
  durationSec: number
  updatedAt: number
  completed: boolean
  genres?: string[]
  country?: string
  profile: string
}

export interface Taste {
  genres: Record<string, number>
  countries: Record<string, number>
}

export interface AiPick extends CatalogItem {
  why: string
  year?: number | null
  genres?: string[]
  country?: string
  duration?: string
  imdbRating?: number | null
  audio?: AudioInfo | null
  hasDirectStream?: boolean
  watchUrl?: string
}

export interface AiResult {
  reply: string
  picks: AiPick[]
  followups: string[]
  source: 'ai' | 'local'
  model?: string
  provider?: string
  targetName?: string
  candidates?: number
  aiError?: string
}

export interface HomeData {
  generatedAt: number
  latest: CatalogItem[]
  korean: CatalogItem[]
  koreanNote?: string
  family: CatalogItem[]
  topRated: CatalogItem[]
  topRatedNote?: string
  hindiConfirmed: CatalogItem[]
  hindiNote?: string
  hindiMovies?: CatalogItem[]
  hindiSeries?: CatalogItem[]
}

export interface HealthInfo {
  ok: boolean
  uptimeSec: number
  catalog: { base: string }
  ai: { provider: string; model: string; configured: boolean }
  tmdb: { configured: boolean }
  mode: string
}
