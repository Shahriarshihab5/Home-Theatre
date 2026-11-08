/**
 * AI recommendation engine, grounded in verified CircleFTP titles.
 *
 * Providers (in order of preference):
 *   1. Google Gemini — free tier available (default).
 *   2. DeepSeek     — optional alternative.
 *   3. Local ranker — always available, uses saved memory + catalog rows.
 *
 * Safety rails:
 *  - The model only ever sees candidates fetched from CircleFTP.
 *  - Returned slugs are validated against that candidate set before they reach the UI.
 *  - If no API key is configured, the local recommender is used instead,
 *    so the app stays fully usable.
 */

import {
  getDetail,
  getListing,
  indexEntry,
  indexedTitles,
  matchPersonFilms,
  peekDetail,
  searchCatalog,
} from './catalog.js'
import { resolvePersonInQuery } from './people.js'

/* ─────────────────────────── provider config ─────────────────────────── */

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
const GEMINI_MODEL = () => stripModelsPrefix(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite')
const GEMINI_FALLBACK_MODEL = () =>
  stripModelsPrefix(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash')
const GEMINI_BASE = () =>
  (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
// Blank = no thinkingConfig (fastest on flash-lite). A positive number allows
// that many thinking tokens. 0 is rejected by the API, so it is treated as off.
const GEMINI_THINKING_BUDGET = () => {
  const raw = process.env.GEMINI_THINKING_BUDGET
  if (!raw) return -1
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : -1
}

const DEEPSEEK_KEY = () => process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = () => (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const DEEPSEEK_MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-flash'
const DEEPSEEK_THINKING = () => (process.env.DEEPSEEK_THINKING || 'disabled').toLowerCase()

// Groq: free plan, no credit card. 30 req/min, 1000 req/day, 8k tokens/min.
const GROQ_KEY = () => process.env.GROQ_API_KEY || ''
const GROQ_BASE = () => (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '')
const GROQ_MODEL = () => process.env.GROQ_MODEL || 'openai/gpt-oss-20b'

// OpenRouter: free `:free` models, 50 requests/day without any purchase.
const OPENROUTER_KEY = () => process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_BASE = () =>
  (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OPENROUTER_MODEL = () =>
  process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'

/**
 * How much of the work the AI does.
 *
 *   intent (default) — the AI only reads the request and writes a short
 *     acknowledgement. The app searches its own catalog and ranks the picks.
 *     This costs roughly a tenth of the tokens of the old flow, so a free
 *     Gemini/Groq quota lasts far longer, and a dead AI still leaves good picks.
 *   full — the older flow: the AI sees every candidate title and chooses.
 *   off — never call an AI provider (same as AI_PROVIDER=local).
 */
const AI_MODE = () => (process.env.AI_MODE || 'intent').toLowerCase()

function stripModelsPrefix(model) {
  return String(model || '').replace(/^models\//, '')
}

/**
 * Providers that speak the OpenAI chat-completions protocol. Gemini has its
 * own native call. Order matters: free options first, paid DeepSeek last.
 */
const PROVIDERS = {
  gemini: {
    id: 'gemini',
    key: GEMINI_KEY,
    base: GEMINI_BASE,
    model: GEMINI_MODEL,
  },
  groq: {
    id: 'groq',
    key: GROQ_KEY,
    base: GROQ_BASE,
    model: GROQ_MODEL,
    headers: () => ({}),
    // gpt-oss is a reasoning model; "low" keeps replies fast and inside the
    // free plan's 8k-tokens-per-minute budget.
    extra: () => (GROQ_MODEL().includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
  },
  openrouter: {
    id: 'openrouter',
    key: OPENROUTER_KEY,
    base: OPENROUTER_BASE,
    model: OPENROUTER_MODEL,
    headers: () => ({
      'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://hometheatre-eight.vercel.app',
      'X-Title': 'Home Movie Theatre',
    }),
    extra: () => ({}),
  },
  deepseek: {
    id: 'deepseek',
    key: DEEPSEEK_KEY,
    base: DEEPSEEK_BASE,
    model: DEEPSEEK_MODEL,
    headers: () => ({}),
    extra: () => (DEEPSEEK_THINKING() !== 'enabled' ? { thinking: { type: 'disabled' } } : {}),
  },
}

/** Configured providers, in the order that will be tried. */
function providerChain() {
  const forced = (process.env.AI_PROVIDER || 'auto').toLowerCase()
  if (forced === 'local') return []
  if (forced !== 'auto') {
    const only = PROVIDERS[forced]
    return only && only.key() ? [only] : []
  }
  return [PROVIDERS.gemini, PROVIDERS.groq, PROVIDERS.openrouter, PROVIDERS.deepseek].filter((p) =>
    p.key(),
  )
}

/**
 * Gemini occasionally stalls for 20+ seconds on a home connection. When that
 * happens, skip that provider for a short while so the TV answers immediately
 * with another provider or the local ranker instead of waiting again.
 */
const AI_COOLDOWN_MS = 60000
const providerCooldownUntil = new Map()

function isCoolingDown(provider) {
  return Date.now() < (providerCooldownUntil.get(provider) || 0)
}

function isTransientError(error) {
  if (!error) return false
  return (
    [404, 429, 500, 502, 503, 504].includes(error.status) ||
    /high demand|overload|abort|fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket/i.test(
      String(error.message || ''),
    )
  )
}

/** A network stall will not be fixed by swapping models; fail fast instead. */
function isNetworkFailure(error) {
  return /abort|fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket/i.test(
    String(error?.message || ''),
  )
}

function openAiCooldown(provider, error) {
  providerCooldownUntil.set(provider, Date.now() + AI_COOLDOWN_MS)
  console.log(
    `[ai] ${provider} circuit open for ${Math.round(AI_COOLDOWN_MS / 1000)}s after: ${String(
      error?.message || error,
    ).slice(0, 120)}`,
  )
}

/** The provider that will be tried first (for health/settings display). */
export function activeProvider() {
  const first = providerChain()[0]
  return first ? first.id : 'local'
}

export const aiConfigured = () => providerChain().length > 0

/* ───────────────────────── candidate gathering ───────────────────────── */

const KEYWORD_MAP = [
  { words: ['korean', 'korea', 'kdrama', 'k-drama'], type: 'country', slug: 'korean' },
  { words: ['south korean', 'south-korea'], type: 'country', slug: 'south-korea' },
  { words: ['indian', 'bollywood', 'hindi cinema'], type: 'country', slug: 'india' },
  { words: ['tamil', 'kollywood'], type: 'country', slug: 'tamil' },
  { words: ['japanese', 'anime', 'japan'], type: 'country', slug: 'japan' },
  { words: ['chinese', 'china'], type: 'country', slug: 'china' },
  { words: ['thai', 'thailand'], type: 'country', slug: 'thailand' },
  { words: ['turkish', 'turkey'], type: 'country', slug: 'turkey' },
  { words: ['american', 'hollywood', 'usa'], type: 'country', slug: 'usa' },
  { words: ['british', 'uk'], type: 'country', slug: 'uk' },
  { words: ['action', 'fight', 'explosion'], type: 'genre', slug: 'action' },
  { words: ['comedy', 'funny', 'laugh'], type: 'genre', slug: 'comedy' },
  { words: ['thriller', 'suspense', 'tense'], type: 'genre', slug: 'thriller' },
  { words: ['horror', 'scary', 'ghost'], type: 'genre', slug: 'horror' },
  { words: ['romance', 'romantic', 'love'], type: 'genre', slug: 'romance' },
  { words: ['drama', 'emotional'], type: 'genre', slug: 'drama' },
  { words: ['family', 'kids', 'children', 'animated'], type: 'genre', slug: 'family' },
  { words: ['animation', 'cartoon', 'anime'], type: 'genre', slug: 'animation' },
  { words: ['crime', 'gangster', 'mafia'], type: 'genre', slug: 'crime' },
  { words: ['mystery', 'detective'], type: 'genre', slug: 'mystery' },
  { words: ['sci-fi', 'science fiction', 'space', 'future'], type: 'genre', slug: 'sci-fi' },
  { words: ['fantasy', 'magic'], type: 'genre', slug: 'fantasy' },
  { words: ['adventure', 'quest'], type: 'genre', slug: 'adventure' },
  { words: ['biography', 'true story'], type: 'genre', slug: 'biography' },
  { words: ['sport', 'sports', 'sports movie'], type: 'genre', slug: 'sport' },
  { words: ['war', 'army', 'military'], type: 'genre', slug: 'war' },
  { words: ['series', 'tv show', 'tv-series', 'episodes'], type: 'genre', slug: 'tv-show' },
]

function hasWord(text, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)
}

function matchSegments(message) {
  const text = String(message || '').toLowerCase()
  const found = []
  for (const entry of KEYWORD_MAP) {
    if (entry.words.some((w) => hasWord(text, w))) found.push(entry)
  }
  // Always add broad, high-quality rows so there are enough verified
  // candidates for a 10–15 title answer, even when the wording is vague.
  const filler = [
    { type: 'genre', slug: 'drama', filler: true },
    { type: 'genre', slug: 'action', filler: true },
    { type: 'genre', slug: 'thriller', filler: true },
    { type: 'genre', slug: 'comedy', filler: true },
    { type: 'genre', slug: 'family', filler: true },
    { type: 'genre', slug: 'tv-show', filler: true },
  ]
  for (const entry of filler) {
    if (!found.some((f) => f.type === entry.type && f.slug === entry.slug)) found.push(entry)
  }
  return found.filter((entry) => !entry.filler).concat(found.filter((entry) => entry.filler)).slice(0, 7)
}

/* Normalised matching against the learned index (genres come from CircleFTP
   detail pages, so "sci-fi" arrives as "Sci-Fi" or "Science Fiction"). */
const GENRE_PATTERNS = {
  action: /^action/i,
  comedy: /^comedy/i,
  thriller: /thriller/i,
  horror: /^horror/i,
  romance: /romance/i,
  drama: /^drama/i,
  family: /^family/i,
  animation: /animation/i,
  crime: /^crime/i,
  mystery: /^mystery/i,
  'sci-fi': /sci[- ]?fi|science fiction/i,
  fantasy: /^fantasy/i,
  adventure: /^adventure/i,
  biography: /biograph/i,
  war: /^war/i,
  history: /history/i,
  sport: /sport/i,
  music: /music/i,
  musical: /musical/i,
  western: /western/i,
  documentary: /document/i,
  'tv-show': /tv|series|soap/i,
}

const COUNTRY_PATTERNS = {
  korean: /korea/i,
  india: /india/i,
  tamil: /tamil/i,
  japan: /japan/i,
  china: /china/i,
  thailand: /thai/i,
  turkey: /turk/i,
  usa: /usa|united states/i,
  uk: /united kingdom|^uk$/i,
  'south-korea': /korea/i,
}

/** Country name (as a viewer or the AI says it) → CircleFTP listing slug. */
const COUNTRY_SLUGS = {
  korea: 'south-korea',
  'south korea': 'south-korea',
  'south-korea': 'south-korea',
  korean: 'south-korea',
  india: 'india',
  indian: 'india',
  bollywood: 'india',
  usa: 'usa',
  'united states': 'usa',
  america: 'usa',
  american: 'usa',
  hollywood: 'usa',
  uk: 'uk',
  britain: 'uk',
  british: 'uk',
  'united kingdom': 'uk',
  england: 'uk',
  japan: 'japan',
  japanese: 'japan',
  china: 'china',
  chinese: 'china',
  thailand: 'thailand',
  thai: 'thailand',
  turkey: 'turkey',
  turkish: 'turkey',
  tamil: 'tamil',
  iran: 'iran',
  iranian: 'iran',
  spain: 'spain',
  spanish: 'spain',
  france: 'france',
  french: 'france',
  germany: 'germany',
  german: 'germany',
  russia: 'russia',
  russian: 'russia',
  indonesia: 'indonesia',
  indonesian: 'indonesia',
  philippines: 'philippines',
  'hong kong': 'hong-kong',
}

function countrySlug(name) {
  const key = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!key) return ''
  if (COUNTRY_SLUGS[key]) return COUNTRY_SLUGS[key]
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Build a matcher for any country slug, including ones not in the table. */
function countryPattern(slug) {
  if (!slug) return null
  if (COUNTRY_PATTERNS[slug]) return COUNTRY_PATTERNS[slug]
  const words = String(slug).split(/[-_]+/).filter(Boolean)
  if (!words.length) return null
  return new RegExp(words.join('[ -]?'), 'i')
}

/** Does this candidate belong to the requested country? */
function inCountry(country, slug) {
  const re = countryPattern(slug)
  if (!re) return false
  return re.test(String(country || ''))
}

function relevanceFor(entry, segments, words) {
  let score = 0
  for (const seg of segments) {
    if (seg.filler) continue
    if (seg.type === 'country') {
      if (inCountry(entry.country, seg.slug)) score += 10
    } else {
      const re = GENRE_PATTERNS[seg.slug]
      if (re && (entry.genres || []).some((g) => re.test(g))) score += 7
    }
  }
  if (words.length) {
    const hay = `${entry.title} ${(entry.genres || []).join(' ')} ${entry.country || ''}`.toLowerCase()
    score += words.filter((w) => hay.includes(w)).length * 6
  }
  return score
}

function dedupeCandidates(pages) {
  const map = new Map()
  for (const page of pages) {
    if (!page) continue
    for (const item of page.items || []) {
      if (!map.has(item.slug)) {
        // Detail data (warm-up / index) gives us the verified audio label and
        // real IMDb rating, so the model does not have to guess.
        const cached = peekDetail(item.slug)
        const learned = indexEntry(item.slug)
        map.set(item.slug, {
          slug: item.slug,
          title: item.title,
          via: page.label,
          thumb: item.thumb || learned?.thumb || '',
          quality: item.quality || learned?.quality,
          imdb: cached?.imdbRating ?? learned?.imdb ?? null,
          genres: cached?.genres || learned?.genres || [],
          country: cached?.country || learned?.country || '',
          series: Boolean(learned?.series),
          audio: cached?.audio?.label && cached.audio.verified ? cached.audio.label : learned?.audio || '',
          hindi: Boolean(cached?.audio?.hindi ?? learned?.hindi),
        })
      }
    }
  }
  return [...map.values()]
}

/** How many detail pages we may fetch per request to learn ratings. */
function ratingBudget() {
  const configured = Number(process.env.RATING_BUDGET)
  if (Number.isFinite(configured) && configured > 0) return configured
  return process.env.VERCEL ? 10 : 36
}

/** Fill in missing ratings for the most promising candidates. */
async function fillRatings(candidates, budget = ratingBudget()) {
  const unknown = candidates.filter((c) => c.imdb == null)
  if (!unknown.length) return
  await Promise.all(
    unknown.slice(0, budget).map(async (c) => {
      const detail = await getDetail(c.slug).catch(() => null)
      if (!detail) return
      c.imdb = detail.imdbRating ?? null
      c.genres = c.genres?.length ? c.genres : detail.genres || []
      c.country = c.country || detail.country || ''
      c.thumb = c.thumb || detail.thumb || ''
      c.quality = c.quality || detail.quality
      c.audio = detail.audio?.verified ? detail.audio.label : c.audio
      c.hindi = c.hindi || Boolean(detail.audio?.hindi)
      c.series = c.series || /tv[\s-]?series|tv[\s-]?show|web[\s-]?series|soap/i.test((detail.genres || []).join(' '))
    }),
  )
}

/** Quality-aware ordering: relevant first, then the best-rated. */
function rankCandidates(candidates) {
  return candidates
    .map((c) => {
      const rating = typeof c.imdb === 'number' ? c.imdb : 5.9 // neutral prior
      const total = (c.rel || 0) * 0.9 + rating * 2.4
      return { c, total }
    })
    .sort((a, b) => b.total - a.total)
    .map(({ c }) => c)
}

async function gatherCandidates(
  message,
  { referenceSlug, intent = null, person: personHint, explicit = null } = {},
) {
  const segments = matchSegments(message)
  // What the viewer actually said, without any words the AI added. An explicit
  // genre in the request must win over genres the model merely inferred.
  const explicitSegments = explicit || segments

  // The AI ("intent mode") can name a genre or country the viewer phrased
  // indirectly ("something like a Scandi noir"). Add those as real listings so
  // the local search reaches them even when the raw words did not match.
  if (intent) {
    for (const genre of intent.genres || []) {
      if (!segments.some((seg) => seg.type === 'genre' && seg.slug === genre)) {
        segments.unshift({ type: 'genre', slug: genre })
      }
    }
    for (const country of intent.countries || []) {
      const slug = countrySlug(country)
      if (slug && !segments.some((seg) => seg.type === 'country' && seg.slug === slug)) {
        segments.unshift({ type: 'country', slug })
      }
    }
  }

  // Actor lookups need a network round-trip; run them first and, when the
  // person is known, answer only from their verified filmography. That is both
  // correct (no padding) and much faster than scanning the whole catalog.
  // The caller may pass a person resolved from the viewer's own words — the AI's
  // guesses are never allowed to decide who an actor is.
  const person =
    personHint !== undefined
      ? personHint
      : await resolvePersonInQuery(message).catch(() => null)
  if (person) {
    const genresOf = (list) =>
      list.filter((seg) => seg.type === 'genre' && !seg.filler).map((seg) => seg.slug)
    const countriesOf = (list) => list.filter((seg) => seg.type === 'country').map((seg) => seg.slug)
    const explicitGenres = genresOf(explicitSegments)
    const aiGenres = genresOf(segments)
    // OR semantics: "Aamir Khan sports drama" keeps both, but an AI guess like
    // "drama" can never widen a request that only said "sports".
    const personGenres = explicitGenres.length ? explicitGenres : aiGenres
    const explicitCountries = countriesOf(explicitSegments)
    const personCountries = explicitCountries.length ? explicitCountries : countriesOf(segments)
    const actorItems = matchPersonFilms(person.films, {
      genres: personGenres,
      countries: personCountries,
      limit: 60,
    })
    if (!actorItems.length) return { candidates: [], person }

    const list = actorItems.map((item) => {
      const learned = indexEntry(item.slug)
      return {
        slug: item.slug,
        title: item.title,
        via: `actor: ${person.name}`,
        thumb: item.thumb || learned?.thumb || '',
        quality: item.quality || learned?.quality,
        imdb: learned?.imdb ?? item.imdbRating ?? null,
        genres: learned?.genres || item.genres || [],
        country: learned?.country || item.country || '',
        series: Boolean(learned?.series),
        audio: learned?.audio || item.audioLabel || '',
        hindi: Boolean(learned?.hindi),
      }
    })
    await fillRatings(rankCandidates(list))
    return { candidates: rankCandidates(list).slice(0, 90), person }
  }

  const pages = []

  // Free-text search often catches the exact title the user mentions.
  const words = `${String(message)} ${(intent?.search || []).join(' ')}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 8)

  const searches = []
  // Phrases proposed by the AI come first: they are the whole point of intent
  // mode. An invented title simply returns nothing and can never reach a pick.
  for (const phrase of intent?.search || []) {
    const clean = String(phrase).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
    if (clean && !searches.includes(clean)) searches.push(clean)
    if (searches.length >= 4) break
  }
  if (words.length) {
    const phrase = words.join(' ')
    if (!searches.includes(phrase)) searches.push(phrase)
  }
  // Individual words help when a phrase like "village thriller" matches
  // nothing as a whole but "village" exists as a title keyword.
  const GENERIC_WORDS = new Set(['family', 'comedy', 'action', 'drama', 'horror', 'romance', 'animation', 'kids'])
  for (const word of words.slice(0, 3)) {
    if (GENERIC_WORDS.has(word)) continue
    if (!searches.includes(word)) searches.push(word)
  }

  const searchPages = await Promise.all(
    searches.slice(0, 5).map(async (q) => {
      const s = await searchCatalog(q).catch(() => null)
      return s && s.items?.length ? { ...s, label: `search: "${q}"` } : null
    }),
  )
  for (const page of searchPages) {
    if (page) pages.push(page)
  }

  // If a reference title was given, pull its genres to find more like it.
  let reference = null
  if (referenceSlug) {
    reference = await getDetail(referenceSlug).catch(() => null)
    if (reference?.genres?.length) {
      for (const genre of reference.genres.slice(0, 2)) {
        const slug = genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const page = await getListing('genre', slug, 0).catch(() => null)
        if (page) pages.push({ ...page, label: `genre: ${genre}` })
      }
    }
    if (reference?.country) {
      const slug = reference.country.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const page = await getListing('country', slug, 0).catch(() => null)
      if (page) pages.push({ ...page, label: `country: ${reference.country}` })
    }
  }

  const segmentPages = await Promise.all(
    segments.map(async (seg) => {
      try {
        const page = await getListing(seg.type, seg.slug, 0)
        return { ...page, label: `${seg.type}: ${seg.slug}` }
      } catch {
        return null
      }
    }),
  )
  pages.push(...segmentPages.filter(Boolean))

  const fromListings = dedupeCandidates(pages)
  for (const candidate of fromListings) {
    candidate.rel = relevanceFor(candidate, segments, words) + 4
  }

  // Everything the app has learned about the catalog, ranked for this request.
  const learned = indexedTitles()
    .map((entry) => {
      const rel = relevanceFor(entry, segments, words)
      return { entry, rel }
    })
    .filter(({ entry, rel }) => rel > 0 || (entry.imdb ?? 0) >= 7.6)
    .sort((a, b) => b.rel * 0.9 + (b.entry.imdb ?? 5.9) * 2.4 - (a.rel * 0.9 + (a.entry.imdb ?? 5.9) * 2.4))
    .slice(0, 160)
    .map(({ entry, rel }) => ({
      slug: entry.slug,
      title: entry.title,
      via: 'learned catalog index',
      thumb: entry.thumb,
      quality: entry.quality,
      imdb: entry.imdb,
      genres: entry.genres || [],
      country: entry.country || '',
      series: Boolean(entry.series),
      audio: entry.audio || '',
      hindi: Boolean(entry.hindi),
      rel,
    }))

  // Merge: listings keep their "found in …" label; the index fills gaps.
  const merged = new Map()
  for (const candidate of fromListings) merged.set(candidate.slug, candidate)
  for (const candidate of learned) {
    const existing = merged.get(candidate.slug)
    if (existing) {
      existing.imdb = existing.imdb ?? candidate.imdb
      existing.rel = Math.max(existing.rel, candidate.rel)
      existing.genres = existing.genres?.length ? existing.genres : candidate.genres
      existing.country = existing.country || candidate.country
      existing.series = existing.series || candidate.series
    } else {
      merged.set(candidate.slug, candidate)
    }
  }

  const pool = [...merged.values()]
  await fillRatings(rankCandidates(pool))
  return { candidates: rankCandidates(pool).slice(0, 90), person: null }
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'like', 'find', 'something', 'movie', 'movies', 'film', 'films',
  'show', 'shows', 'series', 'watch', 'want', 'would', 'please', 'recommend', 'this', 'that',
  'good', 'best', 'new', 'some', 'any', 'have', 'from', 'about', 'can', 'you', 'give', 'suggest',
  'tonight', 'night', 'family friendly', 'friendly', 'dubbed', 'audio', 'language', 'web', 'webrip',
  // Household names/roles must not become catalog search terms.
  'mother', 'mom', 'mum', 'maa', 'brother', 'bro', 'olive', 'olib', 'olibe',
  'shahnaj', 'shahanaj', 'shahnaz', 'shihab', 'shehab', 'profile', 'taste',
  'everyone', 'everybody', 'together', 'household',
])

/* ───────────────────────────── provider calls ───────────────────────────── */

function buildPrompt({
  message,
  candidates,
  memory,
  prefs,
  targetName,
  history = [],
  coverage = {},
  person = null,
}) {
  const liked = (memory?.likes || []).slice(0, 25).map((x) => x.title)
  const disliked = (memory?.dislikes || []).slice(0, 15).map((x) => x.title)
  const watched = (memory?.watched || []).slice(0, 60).map((x) => x.title)
  const watchlist = (memory?.watchlist || []).slice(0, 30).map((x) => x.title)
  const tasteGenres = Object.entries(memory?.taste?.genres || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([g]) => g)
  const tasteCountries = Object.entries(memory?.taste?.countries || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c)

  const messageText = String(message || '')
  const explicitLanguage =
    /\b(korean|japanese|chinese|tamil|telugu|malayalam|turkish|thai|english|hindi|french|spanish|german|russian|indonesian)\b/i.test(
      messageText,
    )
  const wantsHindi = /\bhindi\b|dubbed/i.test(messageText)
  // The viewer can ask the assistant to *speak* in Bengali while the on-screen
  // text stays English, so the model returns a short extra summary for TTS.
  const wantsBanglaVoice = prefs?.voiceLang === 'bn'

  const candidateLines = candidates
    .map(
      (c) =>
        `- ${c.slug} :: ${c.title}${c.quality ? ` [${c.quality}]` : ''}${
          typeof c.imdb === 'number' ? ` [IMDb ${c.imdb.toFixed(1)}]` : ' [rating unknown]'
        }${c.audio ? ` [audio: ${c.audio}]` : ''}${
          c.series ? ' [web series]' : ''
        }${c.genres?.length ? ` [${c.genres.slice(0, 3).join(', ')}]` : ''} (found in ${c.via})`,
    )
    .join('\n')

  const ratedCount = candidates.filter((c) => typeof c.imdb === 'number').length

  const conversation = (Array.isArray(history) ? history : [])
    .filter((turn) => turn && turn.text)
    .slice(-8)
    .map((turn) => `${turn.role === 'assistant' ? 'You' : 'Viewer'}: ${String(turn.text).slice(0, 500)}`)
    .join('\n')

  const system = `You are "Home Movie Theatre", a personal movie companion built into a Smart TV app.
You recommend ONLY titles from the VERIFIED CATALOG below — titles that are confirmed available on the user's CircleFTP service.
You must never invent titles, slugs, ratings or availability.

RULES
1. Return up to 15 titles exclusively from the VERIFIED CATALOG and aim for 10-15. Copy their slugs exactly. If the request is narrow (a specific actor, country, format or audio) and fewer than 10 titles genuinely match, return only the ones that truly match — however few — and say the choice is small. NEVER pad the list with titles that do not satisfy the request just to reach ten.
2. Explain each pick in ONE short sentence ("why", at most 18 words), referencing genre, mood, country, IMDb rating if known, or audio info. Be concrete, not salesy.
3. QUALITY COMES FIRST. The catalog is huge, so never pad the list with weak titles:
   - Strongly prefer titles rated 7.0 or higher.
   - Only include a title rated below 6.0 if you have fewer than 10 candidates rated above it.
   - Never include anything rated below 5.0 unless the viewer explicitly asked for that exact title.
   - "[rating unknown]" means the app has not scanned that title yet — allowed, but place them after picks with good known ratings.
4. Respect preferences: Hindi audio first when the user asks for it; family-friendly tone when family mode is on. An explicit country or language in the request (e.g. "Korean", "Turkish", "Tamil") always overrides the saved Hindi preference and the taste profile. A candidate line may include "[audio: …]" — that label is read from the actual stream filename and is verified, so trust it and say Hindi is available when it is listed. If audio is not listed for a title, say it is unconfirmed rather than guessing. The same honesty applies to content suitability ("check content rating").
5. If the user asks to avoid already-watched titles, exclude them (watched list provided).
6. Reference the user's taste signals when useful ("because you liked …").
7. Conversation tone: warm, concise, TV-friendly. No markdown tables.
8. The "reply" is a short spoken-style answer (2-4 sentences) that introduces the picks. If the catalog cannot fully satisfy the request, say so honestly in ONE short sentence, then present the closest on-topic titles — never quietly swap in an unrelated genre, audience or format.
9. If the request does not name a language or country, do NOT default to one industry. Mix at least three different countries/audio languages. If the request asks for a web series, use only candidates marked "[web series]". If none are marked, say in one sentence that this catalog has no web series, then recommend the closest matching MOVIES from the SAME country/genre/mood. Family, kids and animation titles are only allowed when the viewer asked for family/kids/animation or family mode is on.
10. THIS IS A CONVERSATION. When earlier turns exist, the latest message is usually feedback on your previous picks ("no brother I don't like it", "update a bit", "not this type"). Then: acknowledge it in one short sentence, change the selection meaningfully in the direction the feedback implies, and never repeat a title you already suggested. If the feedback is vague, vary the picks decisively instead of asking many questions.
11. Output STRICT JSON only, matching:
{"reply": string, "picks": [{"slug": string, "why": string}], "followups": [string, string, string]${wantsBanglaVoice ? ', "replyBn": string' : ''}}
${wantsBanglaVoice ? '12. The viewer chose a Bengali speaking voice. Also write "replyBn": a warm, conversational Bengali (বাংলা script) version of the introduction for text-to-speech — 2 to 3 short sentences, as if talking to a friend, addressing the viewer by name. Never use transliteration, English sentences or markdown. If the viewer wrote in Bengali, answer in Bengali there.' : ''}

USER MEMORY
${
  targetName === 'Everyone'
    ? `This request is for the whole household watching together. The memory and taste below are the COMBINED preferences of every person — pick titles that work for everyone, favouring broad overlap and avoiding anything a member disliked. Say it is a group pick for watching together.`
    : targetName
      ? `This request is for ${targetName}. The memory and taste below belong to ${targetName} — use them and address the answer to ${targetName} naturally.`
      : 'This request is for the active profile.'
}
Liked: ${liked.length ? liked.join('; ') : 'none yet'}
Disliked: ${disliked.length ? disliked.join('; ') : 'none yet'}
Watched: ${watched.length ? watched.join('; ') : 'none yet'}
Watchlist: ${watchlist.length ? watchlist.join('; ') : 'none yet'}
Top genres: ${tasteGenres.length ? tasteGenres.join(', ') : 'unknown'}
Top countries: ${tasteCountries.length ? tasteCountries.join(', ') : 'unknown'}

PREFERENCES
Hindi audio preferred: ${
    wantsHindi
      ? 'YES — explicitly requested by the viewer'
      : prefs?.preferHindi && !explicitLanguage
        ? 'soft preference only — never let it override an explicit country or language request'
        : 'no'
  }
Family friendly only: ${prefs?.familyOnly ? 'YES' : 'no'}
Spoken reply language: ${wantsBanglaVoice ? 'Bengali (বাংলা) — also fill "replyBn"' : 'English'}

${conversation ? `CONVERSATION SO FAR\n${conversation}\n\n` : ''}REQUEST COVERAGE
Title type requested: ${coverage.wantsSeries ? 'web series' : 'any'}
Verified web-series candidates in this pool: ${coverage.seriesCount ?? 0}
${
  coverage.wantsSeries && !coverage.seriesCount
    ? 'IMPORTANT: this catalog currently has no verified web series. Say that once, briefly, then recommend the closest matching MOVIES from the same country/genre/mood — do not substitute family, kids or animation titles unless the viewer asked for them.'
    : ''
}

CATALOG QUALITY NOTE
${ratedCount} of the ${candidates.length} candidates below have a verified IMDb rating.
${
  person
    ? `\nACTOR MATCH: the viewer named ${person.name}. Every candidate marked "(found in actor: ${person.name})" is a verified credit and is present in this catalog — recommend ONLY those titles. Do not add any other title, even if it shares a genre, mood or country. If the viewer also named a genre or country, keep only the matching ones; if none match, say so honestly rather than inventing credits.`
    : ''
}

VERIFIED CATALOG (slug :: title):
${candidateLines}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: message },
  ]
}

/* ── Gemini (free tier) ─────────────────────────────────────────────────── */

async function fetchWithRetry(url, init, attempts = 2) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (err) {
      lastError = err
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 450))
    }
  }
  throw lastError
}

async function callGeminiOnce(model, system, user, { withThinking }) {
  const generationConfig = {
    temperature: 0.45,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  }
  if (withThinking) {
    // Thinking tokens come out of maxOutputTokens and repeatedly truncated the
    // JSON answer. Selecting from a fixed list does not need them.
    const budget = GEMINI_THINKING_BUDGET()
    if (budget > 0) generationConfig.thinkingConfig = { thinkingBudget: budget }
  }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  }

  const ctrl = new AbortController()
  // When a free alternative is configured, do not let Gemini eat the whole
  // latency budget: 7s leaves room for Groq/OpenRouter to answer.
  const timeoutMs = GROQ_KEY() || OPENROUTER_KEY() ? 7000 : 9000
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const startedAt = Date.now()
  let res
  try {
    res = await fetchWithRetry(`${GEMINI_BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_KEY(),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (err) {
    console.log(`[ai] ${model} network error after ${Date.now() - startedAt}ms: ${err.message}`)
    throw err
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 400)
    try {
      const err = JSON.parse(text)
      detail = err?.error?.message || detail
    } catch {
      /* raw text is fine */
    }
    const failure = new Error(`Gemini ${res.status} (${model}): ${detail}`)
    failure.status = res.status
    throw failure
  }

  const data = JSON.parse(text)
  const parts = data?.candidates?.[0]?.content?.parts || []
  const content = parts.map((p) => p?.text || '').join('').trim()
  const usage = data?.usageMetadata || {}
  console.log(
    `[ai] ${model} ok in ${Date.now() - startedAt}ms (in=${usage.promptTokenCount ?? '?'}, out=${
      usage.candidatesTokenCount ?? '?'
    }, think=${usage.thoughtsTokenCount ?? 0}, finish=${data?.candidates?.[0]?.finishReason})`,
  )
  if (!content) {
    const blocked = data?.promptFeedback?.blockReason
    const finish = data?.candidates?.[0]?.finishReason
    throw new Error(
      blocked
        ? `Gemini blocked the request (${blocked}).`
        : `Gemini returned an empty response${finish ? ` (${finish})` : ''}.`,
    )
  }
  return content
}

async function callGeminiModel(model, system, user) {
  try {
    return await callGeminiOnce(model, system, user, { withThinking: true })
  } catch (err) {
    // Some models reject thinkingConfig — retry once without it.
    if (err.status === 400 && /thinking|invalid argument/i.test(err.message)) {
      return await callGeminiOnce(model, system, user, { withThinking: false })
    }
    throw err
  }
}

async function callGemini(system, user) {
  const primary = GEMINI_MODEL()

  try {
    const result = await callGeminiModel(primary, system, user)
    providerCooldownUntil.delete('gemini')
    return result
  } catch (primaryError) {
    // A timeout / DNS / socket failure is not model-specific. Swapping to the
    // fallback would just wait another timeout, so stop immediately.
    if (isNetworkFailure(primaryError)) {
      openAiCooldown('gemini', primaryError)
      throw primaryError
    }

    // Free-tier models can be overloaded (503) or quota-limited (429). The
    // fallback model has a separate free quota — use it as a safety net.
    const fallback = GEMINI_FALLBACK_MODEL()
    const retriable = isTransientError(primaryError)
    console.log(`[ai] primary ${primary} failed: ${primaryError.message.slice(0, 140)} (fallback=${retriable})`)

    if (fallback && fallback !== primary && retriable) {
      try {
        const result = await callGeminiModel(fallback, system, user)
        providerCooldownUntil.delete('gemini')
        return result
      } catch (fallbackError) {
        if (isTransientError(fallbackError)) openAiCooldown('gemini', fallbackError)
        throw new Error(`${primaryError.message} → fallback ${fallbackError.message}`)
      }
    }

    if (isTransientError(primaryError)) openAiCooldown('gemini', primaryError)
    throw primaryError
  }
}

/* ── OpenAI-compatible providers (Groq, OpenRouter, DeepSeek) ───────────── */

async function callOpenAiCompatible(provider, messages) {
  const body = {
    model: provider.model(),
    messages,
    temperature: 0.45,
    max_tokens: 1600,
    response_format: { type: 'json_object' },
    stream: false,
    ...(provider.extra ? provider.extra() : {}),
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9000)
  let res
  try {
    res = await fetch(`${provider.base()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key()}`,
        ...(provider.headers ? provider.headers() : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 400)
    try {
      const err = JSON.parse(text)
      detail = err?.error?.message || detail
    } catch {
      /* raw text is fine */
    }
    const error = new Error(`${provider.id} ${res.status}: ${detail}`)
    error.status = res.status
    throw error
  }

  const data = JSON.parse(text)
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error(`${provider.id} returned an empty response`)
  return content
}

/* ── dispatcher ─────────────────────────────────────────────────────────── */

async function callModel(messages) {
  const chain = providerChain()
  if (!chain.length) throw new Error('No AI key configured')

  let lastError = null
  for (const provider of chain) {
    if (isCoolingDown(provider.id)) continue
    try {
      let content
      if (provider.id === 'gemini') {
        const system = messages.find((m) => m.role === 'system')?.content || ''
        const user = messages.find((m) => m.role === 'user')?.content || ''
        content = await callGemini(system, user)
      } else {
        content = await callOpenAiCompatible(provider, messages)
      }
      providerCooldownUntil.delete(provider.id)
      return { content, provider: provider.id, model: provider.model() }
    } catch (err) {
      lastError = err
      console.log(
        `[ai] ${provider.id} unavailable: ${String(err?.message || err).slice(0, 160)}`,
      )
      if (isTransientError(err) && !isCoolingDown(provider.id)) {
        openAiCooldown(provider.id, err)
      }
      // Try the next configured provider. Free alternatives live on different
      // hosts, so a Google outage does not take the whole assistant down.
    }
  }

  throw lastError || new Error('No AI provider available')
}

function parseJsonLoose(content) {
  const raw = String(content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1))
    throw new Error('Model returned non-JSON output')
  }
}

/* ── intent mode ─────────────────────────────────────────────────────────
 * The AI reads the request; the app does the searching. No candidate list is
 * sent, so the prompt is a few hundred tokens instead of several thousand.
 * The AI cannot add a title because it never returns titles — every card on
 * screen comes from a CircleFTP search.
 * ---------------------------------------------------------------------- */

const INTENT_GENRES = new Set([
  'action', 'adventure', 'animation', 'biography', 'comedy', 'crime', 'documentary', 'drama',
  'family', 'fantasy', 'history', 'horror', 'music', 'musical', 'mystery', 'romance', 'sci-fi',
  'sport', 'thriller', 'war', 'western',
])

/** Household names in Bengali script, so TTS pronounces them correctly. */
const BENGALI_NAMES = {
  shihab: 'শিহাব',
  olive: 'অলিভ',
  shahnaj: 'শাহনাজ',
  everyone: 'সবাই',
}

function buildIntentPrompt({ message, memory, prefs, targetName, history = [], topic = '' }) {
  const wantsBanglaVoice = prefs?.voiceLang === 'bn'
  const conversation = (Array.isArray(history) ? history : [])
    .filter((turn) => turn && turn.text)
    .slice(-6)
    .map(
      (turn) =>
        `${turn.role === 'assistant' ? 'You' : 'Viewer'}: ${String(turn.text).slice(0, 240)}`,
    )
    .join('\n')
  const tasteGenres = Object.entries(memory?.taste?.genres || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([genre]) => genre)
  const tasteCountries = Object.entries(memory?.taste?.countries || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([country]) => country)

  const schema = `{
  "search": [string],
  "genres": [string],
  "countries": [string],
  "languages": [string],
  "person": string|null,
  "yearFrom": number|null,
  "yearTo": number|null,
  "wantsSeries": boolean,
  "mood": string,
  "reply": string${wantsBanglaVoice ? ',\n  "replyBn": string' : ''}
}`

  const system = `You are the request reader for "Home Movie Theatre", a Smart TV app that owns a verified CircleFTP movie catalog.
You NEVER choose, name or promise movies. A separate local engine searches the catalog and attaches the titles. Your only job is to describe what the viewer wants and to write one short spoken acknowledgement.

Return STRICT JSON only, matching:
${schema}

FIELDS
- search: up to 4 short phrases the app will run against its own catalog. Use words the viewer actually said plus standard genre/country vocabulary. NEVER invent a movie title and never add a title the viewer did not say.
- genres: only from action, adventure, animation, biography, comedy, crime, documentary, drama, family, fantasy, history, horror, music, mystery, romance, sci-fi, sport, thriller, war, western. List ONLY genres the viewer explicitly asked for or a direct synonym. Do not add genres you merely infer are typical (for example, do not add "drama" or "biography" to a sports request).
- countries: only what the viewer clearly asked for (e.g. Korea, India, USA, Japan, Turkey, Thailand, China, UK, France).
- languages: only what the viewer clearly asked for (e.g. Hindi, Korean, English, Tamil, Japanese, Turkish).
- person: actor or director the viewer named, else null.
- yearFrom / yearTo: only when the viewer names a year or decade, else null.
- wantsSeries: true only when the viewer asks for a web series, TV show, season or episodes.
- mood: 2-5 words, e.g. "tense revenge thriller".
- reply: 1-2 warm, TV-friendly sentences that acknowledge the request and mention the theme, country or mood. Do NOT name titles. Do NOT promise availability.
${wantsBanglaVoice ? '- replyBn: the same acknowledgement in conversational Bengali script (বাংলা), 1-2 short sentences. No transliteration and no English sentences.' : ''}${
    wantsBanglaVoice && targetName && BENGALI_NAMES[String(targetName).toLowerCase()]
      ? `\n- In replyBn write the viewer's name exactly as "${BENGALI_NAMES[String(targetName).toLowerCase()]}".`
      : ''
  }

RULES
- An explicit country or language in the request overrides any saved Hindi preference.
- If the latest message is feedback on previous picks ("no", "not these", "something else"), keep the original topic and read the feedback as a direction. Never repeat old titles in "search".
- Never invent titles, ratings or availability.
- Keep every list short. An empty array is correct when the viewer said nothing about it.

VIEWER
${
  targetName === 'Everyone'
    ? 'The whole household is watching together.'
    : targetName
      ? `This is for ${targetName}.`
      : 'Active profile.'
}
Saved taste genres: ${tasteGenres.length ? tasteGenres.join(', ') : 'unknown'}
Saved taste countries: ${tasteCountries.length ? tasteCountries.join(', ') : 'unknown'}
Saved Hindi preference: ${prefs?.preferHindi ? 'yes' : 'no'}
Family mode: ${prefs?.familyOnly ? 'on' : 'off'}
${topic ? `Current topic from earlier turns: ${String(topic).slice(0, 300)}` : ''}
${conversation ? `\nCONVERSATION SO FAR\n${conversation}` : ''}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: String(message || '') },
  ]
}

function cleanList(value, limit) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

function cleanYear(value) {
  const year = Number(value)
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? Math.round(year) : null
}

function normalizeIntent(parsed) {
  const genres = cleanList(parsed?.genres, 4)
    .map((genre) => genre.toLowerCase().replace(/\s+/g, '-'))
    .filter((genre) => INTENT_GENRES.has(genre))
  const countries = cleanList(parsed?.countries, 3).filter((country) => countrySlug(country))
  const languages = cleanList(parsed?.languages, 3)
  // Search phrases must be plain words; drop anything that looks like a slug or
  // a URL so a confused model cannot steer the app somewhere unexpected.
  const search = cleanList(parsed?.search, 4).filter(
    (phrase) => !/https?:|www\.|\/|\.html?$/i.test(phrase),
  )
  const person =
    typeof parsed?.person === 'string' && parsed.person.trim().length > 2
      ? parsed.person.replace(/\s+/g, ' ').trim().slice(0, 60)
      : null

  return {
    search,
    genres,
    countries,
    languages,
    person,
    yearFrom: cleanYear(parsed?.yearFrom),
    yearTo: cleanYear(parsed?.yearTo),
    wantsSeries: Boolean(parsed?.wantsSeries),
    mood: typeof parsed?.mood === 'string' ? parsed.mood.trim().slice(0, 60) : '',
    reply: typeof parsed?.reply === 'string' ? parsed.reply.trim().slice(0, 320) : '',
    replyBn: typeof parsed?.replyBn === 'string' ? parsed.replyBn.trim().slice(0, 400) : '',
  }
}

// Identical requests are common on a TV (the viewer re-asks, or the remote
// double-fires). Serving them from memory costs zero quota.
const intentCache = new Map()
const INTENT_TTL = 30 * 60 * 1000

function intentCacheKey(message, { prefs, targetName, topic, history }) {
  const lastTurn = Array.isArray(history) && history.length
    ? String(history[history.length - 1]?.text || '').slice(0, 120)
    : ''
  return [
    String(message || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160),
    targetName || '',
    prefs?.voiceLang || 'en',
    prefs?.familyOnly ? 'family' : '',
    prefs?.preferHindi ? 'hindi' : '',
    String(topic || '').slice(0, 80),
    lastTurn,
  ].join('|')
}

async function interpretRequest({ message, memory = {}, prefs = {}, targetName = null, history = [], topic = '' }) {
  const key = intentCacheKey(message, { prefs, targetName, topic, history })
  const hit = intentCache.get(key)
  if (hit && Date.now() - hit.at < INTENT_TTL) {
    return { ...hit.data, cached: true }
  }

  const prompt = buildIntentPrompt({ message, memory, prefs, targetName, history, topic })
  const answer = await callModel(prompt)
  const parsed = parseJsonLoose(answer.content)
  const intent = normalizeIntent(parsed)

  const data = {
    intent,
    provider: answer.provider,
    model: answer.model,
  }
  intentCache.set(key, { at: Date.now(), data })
  if (intentCache.size > 400) {
    // Drop the oldest quarter so the map cannot grow forever.
    const sorted = [...intentCache.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [oldKey] of sorted.slice(0, 100)) intentCache.delete(oldKey)
  }
  return data
}

/** Fold the AI's reading of the request into the text the catalog searches. */
function mergeIntentText(text, intent) {
  if (!intent) return String(text || '')
  const parts = [String(text || '')]
  // Deliberately no person names here: actor lookups must come from the
  // viewer's own words, otherwise a hallucinated name can hijack the answer.
  for (const phrase of intent.search || []) parts.push(phrase)
  for (const genre of intent.genres || []) parts.push(genre.replace(/-/g, ' '))
  for (const country of intent.countries || []) parts.push(country)
  for (const language of intent.languages || []) parts.push(language)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}


/* ───────────────────────── local fallback ───────────────────────── */

function localRecommend(
  message,
  candidates,
  memory,
  prefs,
  { aiAttempted = false, targetName = null, intent = null } = {},
) {
  const likedGenres = new Map(
    Object.entries(memory?.taste?.genres || {}).sort((a, b) => b[1] - a[1]).slice(0, 6),
  )
  const lowered = String(message || '').toLowerCase()
  const familyWords = /family|kids|children|cartoon|animated|family-friendly/.test(lowered)
  const wantsNew = /new|not watched|unwatched|haven'?t|already watched|exclude/.test(lowered)
  const wantsHindi = /hindi|dubbed/.test(lowered) || Boolean(intent?.languages?.some((l) => /hindi/i.test(l)))
  const wantsKorean =
    /korean|korea|kdrama|k-drama/.test(lowered) ||
    Boolean(intent?.countries?.some((c) => /korea/i.test(c)))
  const wantsThriller = /thriller|suspense/.test(lowered)
  const wantsSeries = intent?.wantsSeries || /series|tv show|episodes|season|web series/.test(lowered)
  const watchedSlugs = new Set((memory?.watched || []).map((x) => x.slug))

  // Signals from the AI's reading of the request. They only re-order verified
  // candidates; they never add a title the catalog does not contain.
  const intentGenreRes = (intent?.genres || []).map((genre) => GENRE_PATTERNS[genre]).filter(Boolean)
  const intentCountries = (intent?.countries || []).map(countrySlug).filter(Boolean)
  const intentLanguages = (intent?.languages || []).map((lang) => lang.toLowerCase())

  const scored = candidates
    .filter((c) => !(wantsNew && watchedSlugs.has(c.slug)))
    .map((c) => {
      let score = typeof c.rel === 'number' ? c.rel : 0
      for (const [genre, weight] of likedGenres) {
        if ((c.genres || []).some((g) => g.toLowerCase() === genre.toLowerCase())) score += weight
        else if (c.via.toLowerCase().includes(genre.toLowerCase())) score += weight * 0.5
      }
      if (familyWords && /family|animation/i.test(c.via)) score += 8
      if (prefs?.familyOnly && /family|animation/i.test(c.via)) score += 5
      if (wantsKorean && /korean/i.test(c.via)) score += 14
      if (wantsThriller && /thriller|crime|mystery/i.test(c.via)) score += 8
      if (wantsSeries && /tv-show|tv-series|series/i.test(c.via)) score += 10
      if (wantsHindi && (c.hindi || /hindi/i.test(c.title))) score += 2
      if (/search:/i.test(c.via)) score += 6
      if (intentGenreRes.length && (c.genres || []).some((g) => intentGenreRes.some((re) => re.test(g)))) {
        score += 9
      }
      if (intentCountries.length && intentCountries.some((slug) => inCountry(c.country, slug))) score += 9
      if (
        intentLanguages.length &&
        intentLanguages.some((lang) =>
          `${c.audio || ''} ${(c.genres || []).join(' ')}`.toLowerCase().includes(lang),
        )
      ) {
        score += 5
      }
      // Real quality dominates: a 7.8 title beats a 4.9 one by a wide margin.
      score += (typeof c.imdb === 'number' ? c.imdb : 6) * 4
      return { ...c, score }
    })
    .sort((a, b) => b.score - a.score)

  const picks = scored.slice(0, 12).map((c) => ({
    slug: c.slug,
    why:
      typeof c.imdb === 'number'
        ? `IMDb ${c.imdb.toFixed(1)} and verified in the catalog${
            c.audio ? ` · ${c.audio}` : ''
          }.`
        : `Verified in the CircleFTP catalog${c.audio ? ` · ${c.audio}` : ''}.`,
  }))

  const wanted = [
    wantsKorean ? 'Korean titles' : null,
    wantsThriller ? 'thriller' : null,
    wantsHindi ? 'Hindi audio' : null,
    intent?.mood || null,
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ') || ''

  return {
    reply: `${
      targetName === 'Everyone'
        ? 'Picks for everyone watching together. '
        : targetName
          ? `Picks for ${targetName}. `
          : ''
    }Here are catalog-verified picks${
      wanted ? ` — prioritising ${wanted}` : ''
    }${familyWords ? ' for a family-friendly night' : ''}. ${
      aiAttempted
        ? 'The AI service is temporarily unavailable, so these are ranked from your saved taste and CircleFTP listings.'
        : 'AI recommendations are offline right now (no free Gemini key configured), so these are ranked from your saved taste and CircleFTP listings.'
    }`,
    picks,
    followups: ['Something similar to my favourites', 'Korean thriller in Hindi', 'Something light and funny'],
    targetName: targetName || undefined,
  }
}

/* ───────────────────────── public API ───────────────────────── */

async function hydratePicks(picks, candidateMap, { referenceSlug } = {}) {
  const valid = picks
    .map((p) => ({ slug: String(p.slug || '').trim(), why: String(p.why || '').trim() }))
    .filter((p) => candidateMap.has(p.slug) && p.slug !== referenceSlug)
    .slice(0, 15)

  const hydrated = await Promise.all(
    valid.map(async (p) => {
      const base = candidateMap.get(p.slug)
      const detail = await getDetail(p.slug).catch(() => null)
      return {
        slug: p.slug,
        title: detail?.title || base?.title || p.slug,
        thumb: detail?.thumb || base?.thumb || '',
        quality: detail?.quality || base?.quality,
        why: p.why,
        year: detail?.year ?? null,
        genres: detail?.genres || [],
        country: detail?.country || '',
        duration: detail?.duration || '',
        imdbRating: detail?.imdbRating ?? null,
        audio: detail?.audio || null,
        hasDirectStream: Boolean(detail?.sources?.length),
        watchUrl: detail?.watchUrl || `http://hd.circleftp.net/watch/${p.slug}.html`,
      }
    }),
  )
  return hydrated
}

function isKoreanPick(pick) {
  return /korea/i.test(pick.country || '') || (pick.genres || []).some((g) => /korean/i.test(g))
}

/** Re-rank offline picks to honour explicit language/country/genre requests. */
function polishLocalPicks(picks, message) {
  const text = String(message || '').toLowerCase()
  const wantsHindi = /hindi|dubbed/.test(text)
  const wantsKorean = /korean|korea|kdrama|k-drama/.test(text)
  const wantsThriller = /thriller|suspense/.test(text)

  return picks
    .map((pick) => {
      let score = 0
      if (wantsHindi && pick.audio?.hindi) score += 4
      if (wantsKorean && isKoreanPick(pick)) score += 3
      if (wantsThriller && (pick.genres || []).some((g) => /thriller|crime|mystery/i.test(g))) score += 2
      return { pick, score }
    })
    .sort((a, b) => b.score - a.score)
    .map(({ pick }) =>
      Object.assign({}, pick, {
        why: [
          pick.why,
          pick.audio?.hindi ? 'Hindi audio is listed in the source.' : null,
          isKoreanPick(pick) ? 'Korean title.' : null,
        ]
          .filter(Boolean)
          .join(' '),
      }),
    )
}

/**
 * A weak pick is a wasted slot, but never cut the list below something useful.
 * Only drop titles rated under `min` when that still leaves `enough` picks.
 */
function applyQualityFloor(picks, { min = 6.0, enough = 10 } = {}) {
  if (picks.length <= 4) return picks
  const solid = picks.filter((pick) => pick.imdbRating == null || pick.imdbRating >= min)
  if (solid.length >= enough) return solid.slice(0, 12)
  return picks.slice(0, 12)
}

function summarizePicks(picks) {
  const rated = picks.filter((pick) => typeof pick.imdbRating === 'number')
  const avgRating = rated.length
    ? Math.round((rated.reduce((sum, pick) => sum + pick.imdbRating, 0) / rated.length) * 10) / 10
    : null
  return { avgRating, ratedCount: rated.length }
}

/** The AI's acknowledgement + the real titles the app actually matched. */
function composeIntentReply({ intent, picks, targetName }) {
  const head = String(intent?.reply || '').trim()
  const who = targetName === 'Everyone' ? ' for everyone' : targetName ? ` for ${targetName}` : ''
  const fallback = `Here ${
    picks.length === 1 ? 'is 1 verified catalog pick' : `are ${picks.length} verified catalog picks`
  }${who}${intent?.mood ? ` for a ${intent.mood} night` : ''}.`
  const names = picks.slice(0, 3).map((pick) => pick.title).filter(Boolean)
  if (!names.length) return head || "I couldn't find anything matching that in the catalog."
  // Only skip the list when the model already named at least two of the picks;
  // a short title like "Aamir" would otherwise match "Aamir Khan" by accident.
  const namedCount = names.filter((name) => head.toLowerCase().includes(name.toLowerCase())).length
  if (namedCount >= Math.min(2, names.length)) return head || fallback
  return `${head || fallback} Top matches: ${names.join(', ')}.`
}

function buildFollowups(intent, personName) {
  if (personName) return [`Best of ${personName}`, 'Something different', 'A family pick']
  return [
    intent?.mood ? `More like ${intent.mood}` : 'Something with higher ratings',
    'Something different',
    'A family pick',
  ]
}

export async function recommend({
  message,
  memory = {},
  prefs = {},
  referenceSlug,
  targetName = null,
  avoidSlugs = [],
  history = [],
  topic = '',
} = {}) {
  const text = String(message || '').trim()
  if (!text) throw Object.assign(new Error('Message is required'), { status: 400 })

  const avoid = new Set((Array.isArray(avoidSlugs) ? avoidSlugs : []).map((s) => String(s)))
  // When the viewer is reacting to previous picks ("no brother, not these"),
  // gather candidates for the original topic, not for the complaint itself.
  const baseText = topic ? `${topic} ${text}` : text

  const usableProviders = providerChain().filter((provider) => !isCoolingDown(provider.id))
  const mode = AI_MODE()
  const aiAvailable = usableProviders.length > 0 && mode !== 'off'

  // ── intent pass ──────────────────────────────────────────────────────────
  // A cheap AI call that sends no candidate list. It only reads the request and
  // writes a short acknowledgement; the catalog search below does the finding.
  // That keeps a free quota usable for far longer, and a dead provider costs a
  // few seconds instead of the whole answer.
  let intentCall = null
  let intentError = ''
  // The actor lookup and the AI intent read run in parallel: the person must
  // come from the viewer's own words, never from the model.
  const [intentResult, person] = await Promise.all([
    aiAvailable && mode === 'intent'
      ? interpretRequest({
          message: text,
          memory,
          prefs,
          targetName,
          history,
          topic,
        }).catch((err) => {
          intentError = String(err?.message || err)
          console.log(`[ai] intent unavailable: ${intentError.slice(0, 160)}`)
          return null
        })
      : Promise.resolve(null),
    resolvePersonInQuery(baseText).catch(() => null),
  ])
  intentCall = intentResult
  const intent = intentCall?.intent || null
  const gatheringText = intent ? mergeIntentText(baseText, intent) : baseText
  const gathered = await gatherCandidates(gatheringText, {
    referenceSlug,
    intent,
    person,
    explicit: matchSegments(baseText),
  })
  const candidates = avoid.size
    ? gathered.candidates.filter((c) => !avoid.has(c.slug))
    : gathered.candidates
  if (!candidates.length) {
    const who = gathered.person?.name
    return {
      reply: who
        ? `I couldn't find any ${who} titles matching that request in this catalog. Try a different genre, or ask for ${who}'s best movies.`
        : "I couldn't find alternative titles for that request. Try widening the genre, country or year.",
      picks: [],
      followups: who
        ? [`Best of ${who}`, 'Something similar but different', 'Try another genre']
        : ['Try another genre', 'Something family-friendly', 'Korean thriller'],
      source: 'local',
      candidates: 0,
    }
  }

  const candidateMap = new Map(candidates.map((c) => [c.slug, c]))

  // ── request coverage ─────────────────────────────────────────────────────
  // The catalog is movie-heavy and has no real TV-series section, so the model
  // must know that up front instead of pretending or swapping in random titles.
  const wantsSeries =
    Boolean(intent?.wantsSeries) ||
    /\b(web[\s-]?series|tv[\s-]?series|tv[\s-]?show|series|seasons?|episodes?)\b/i.test(text)
  const seriesCount = candidates.filter((c) => c.series).length
  const coverage = { wantsSeries, seriesCount }
  const focusCountries = matchSegments(gatheringText).filter(
    (segment) => !segment.filler && segment.type === 'country',
  )

  const coolingDown = aiConfigured() && usableProviders.length === 0
  if (!aiAvailable) {
    const local = localRecommend(text, candidates, memory, prefs, {
      aiAttempted: coolingDown,
      targetName,
      intent,
    })
    const picks = await hydratePicks(local.picks, candidateMap)
    return {
      ...local,
      picks: applyQualityFloor(polishLocalPicks(picks, gatheringText)),
      source: 'local',
      candidates: candidates.length,
      aiCooldown: coolingDown,
    }
  }

  // ── intent mode (default) ────────────────────────────────────────────────
  // The AI read the request; the app searched the catalog and ranked the real
  // titles. The AI never saw a candidate list and never returned a title, so
  // nothing on screen can be invented.
  if (mode === 'intent' && intent) {
    const local = localRecommend(text, candidates, memory, prefs, { targetName, intent })
    const picks = await hydratePicks(local.picks, candidateMap)
    const polished = applyQualityFloor(polishLocalPicks(picks, gatheringText))
    const reply = composeIntentReply({ intent, picks: polished, targetName })
    const replyBn =
      intent.replyBn ||
      (prefs?.voiceLang === 'bn'
        ? `আমি আপনার জন্য ক্যাটালগ থেকে ${polished.length}টি সিনেমা বেছে নিয়েছি। নিচে দেখে নিন।`
        : '')

    return {
      reply,
      replyBn: replyBn || undefined,
      picks: polished,
      followups: buildFollowups(intent, gathered.person?.name),
      source: 'ai',
      mode: 'intent',
      model: intentCall.model,
      provider: intentCall.provider,
      targetName: targetName || undefined,
      candidates: candidates.length,
      ...summarizePicks(polished),
    }
  }

  // ── full mode: the AI chooses from the verified candidate list ───────────
  const prompt = buildPrompt({
    message: text,
    candidates,
    memory,
    prefs,
    targetName,
    history,
    coverage,
    person: gathered.person,
  })
  let parsed
  let rawContent = ''
  let lastError = 'AI unavailable'
  let answeredBy = null
  // One retry: free-tier models occasionally answer with prose, truncate, or hit
  // a transient network blip. The retry hardens the JSON-only instruction.
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    if (
      attempt > 0 &&
      !providerChain().some((provider) => !isCoolingDown(provider.id))
    ) {
      break
    }
    try {
      const messages =
        attempt === 0
          ? prompt
          : prompt.map((m) =>
              m.role === 'system'
                ? {
                    ...m,
                    content: `${m.content}\n\nIMPORTANT: reply with ONLY the JSON object described above. No prose, no markdown fences, no commentary before or after.`,
                  }
                : m,
            )
      answeredBy = await callModel(messages)
      rawContent = answeredBy.content
      parsed = parseJsonLoose(rawContent)
    } catch (err) {
      lastError = String(err?.message || err)
      console.log(`[ai] attempt ${attempt + 1} failed: ${lastError} | raw=${rawContent.slice(0, 200)}`)
    }
  }
  if (!parsed) {
    // Fall back gracefully rather than breaking the TV experience.
    const local = localRecommend(text, candidates, memory, prefs, { aiAttempted: true, targetName })
    const picks = await hydratePicks(local.picks, candidateMap)
    return {
      ...local,
      picks: polishLocalPicks(picks, text),
      source: 'local',
      candidates: candidates.length,
      aiError: lastError,
    }
  }

  let hydrated = await hydratePicks(
    Array.isArray(parsed.picks) ? parsed.picks : [],
    candidateMap,
    { referenceSlug },
  )

  // ── country guard ────────────────────────────────────────────────────────
  // An explicit country request must never come back with other countries.
  // Only enforce it when enough matching picks exist to stay useful.
  const inRequestedCountry = (pick) => {
    if (!focusCountries.length) return true
    return focusCountries.some((segment) => {
      const re = COUNTRY_PATTERNS[segment.slug]
      if (!re) return true
      return re.test(pick.country || '') || (pick.genres || []).some((genre) => re.test(genre))
    })
  }
  if (focusCountries.length) {
    const matching = hydrated.filter(inRequestedCountry)
    if (matching.length >= 5) hydrated = matching
  }

  // ── quality guard ────────────────────────────────────────────────────────
  // The catalog has thousands of titles, so a weak pick is a wasted slot.
  // Drop poorly-rated picks only when enough good ones remain.
  const strongEnough = hydrated.filter((p) => (p.imdbRating ?? 10) >= 5.5)
  const weakDropped = strongEnough.length >= 10
  if (weakDropped) hydrated = strongEnough

  // Models sometimes ignore the count. Top up from the same verified candidate
  // set — best-rated first — so the viewer always gets a useful 10–15 spread.
  const MIN_PICKS = 10
  const MAX_PICKS = 15
  let toppedUp = false
  if (hydrated.length < MIN_PICKS) {
    const have = new Set(hydrated.map((p) => p.slug))
    // Prefer extras that satisfy the same country, so topping up cannot drag
    // the answer off-topic.
    const countryPool = focusCountries.length
      ? candidates.filter((c) =>
          focusCountries.some((segment) => {
            const re = COUNTRY_PATTERNS[segment.slug]
            return re ? re.test(c.country || '') || c.via.includes(segment.slug) : false
          }),
        )
      : []
    const topUpPool =
      countryPool.length >= Math.min(MIN_PICKS, hydrated.length + countryPool.length)
        ? countryPool
        : candidates
    const extras = topUpPool
      .filter((c) => !have.has(c.slug) && c.slug !== referenceSlug)
      .filter((c) => (c.imdb ?? 10) >= 5.5)
      .sort((a, b) => (b.imdb ?? 0) - (a.imdb ?? 0))
      .slice(0, MIN_PICKS - hydrated.length)
      .map((c) => ({
        slug: c.slug,
        why:
          typeof c.imdb === 'number'
            ? `IMDb ${c.imdb.toFixed(1)} — one of the best-rated matches in your catalog.`
            : 'Verified in your CircleFTP catalog and a good fit for this request.',
      }))
    if (extras.length) {
      const extraHydrated = await hydratePicks(extras, candidateMap, { referenceSlug })
      hydrated = [...hydrated, ...extraHydrated].slice(0, MAX_PICKS)
      toppedUp = true
    }
  }

  const rated = hydrated.filter((p) => typeof p.imdbRating === 'number')
  const avgRating = rated.length
    ? Math.round((rated.reduce((sum, p) => sum + p.imdbRating, 0) / rated.length) * 10) / 10
    : null

  const baseReply = String(parsed.reply || 'Here are some verified picks from your catalog.').trim()

  return {
    reply: toppedUp ? `${baseReply} I also added a few more verified catalog options.` : baseReply,
    replyBn: String(parsed.replyBn || '').trim() || undefined,
    picks: hydrated,
    followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 4).map(String) : [],
    source: 'ai',
    model: answeredBy?.model || aiMeta().model,
    provider: answeredBy?.provider || activeProvider(),
    targetName: targetName || undefined,
    candidates: candidates.length,
    avgRating,
    ratedCount: rated.length,
    qualityFiltered: weakDropped,
  }
}

export async function similarTo(slug) {
  const detail = await getDetail(slug).catch(() => null)
  if (!detail) throw Object.assign(new Error('Title not found'), { status: 404 })

  const message = `Find something similar to "${detail.title}" (${detail.genres.join(', ') || 'unknown genre'}${
    detail.country ? `, ${detail.country}` : ''
  }). Exclude the title itself.`
  return recommend({ message, referenceSlug: slug })
}

export const aiMeta = () => {
  const chain = providerChain()
  const primary = chain[0] || null
  return {
    provider: primary ? primary.id : 'local',
    model: primary ? primary.model() : '',
    configured: chain.length > 0,
    baseUrl: primary ? primary.base() : '',
    // Free options are listed so Settings can show what will answer next.
    providers: chain.map((provider) => provider.id),
    coolingDown: chain
      .filter((provider) => isCoolingDown(provider.id))
      .map((provider) => provider.id),
    // "intent" = the AI reads the request and the app searches; "full" = the
    // AI chooses from the whole candidate list (more tokens).
    mode: AI_MODE(),
  }
}
