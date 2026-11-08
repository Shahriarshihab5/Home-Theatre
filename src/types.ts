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

export type VoiceLang = 'en' | 'bn'
export type VoiceGender = 'female' | 'male'
/** Language spoken into the microphone. */
export type ListenLang = 'en' | 'bn'

export interface Prefs {
  preferHindi: boolean
  familyOnly: boolean
  tts: boolean
  /** Spoken-reply language; the on-screen text stays English. */
  voiceLang: VoiceLang
  /** Preferred speech-synthesis voice. */
  voiceGender: VoiceGender
  /** What you speak into the mic: English or Bengali. */
  listenLang: ListenLang
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
  /** Bengali spoken summary used when the voice language is Bangla. */
  replyBn?: string
  picks: AiPick[]
  followups: string[]
  source: 'ai' | 'local'
  model?: string
  provider?: string
  targetName?: string
  candidates?: number
  avgRating?: number | null
  ratedCount?: number
  qualityFiltered?: boolean
  aiError?: string
}

export interface StreamTrack {
  ordinal: number
  streamIndex: number
  lang: string
  language: string
  codec: string
  codecLabel: string
  channels: string
  browserSafe: boolean
  isDefault: boolean
}

export interface StreamInfo {
  slug: string
  source: string
  transcode: boolean
  filenameAudio: AudioInfo | null
  downloadUrl: string
  watchUrl: string
  info: {
    durationSec: number | null
    video: { streamIndex: number; codec: string; width: number | null; height: number | null; browserSafe: boolean } | null
    audio: StreamTrack[]
    subtitles: { streamIndex: number; lang: string; language: string; codec: string }[]
    directPlayable: boolean
    audioNeedsRemux: boolean
  } | null
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
  lan?: { url: string }
}
