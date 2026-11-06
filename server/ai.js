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

import { getDetail, getListing, indexEntry, indexedTitles, peekDetail, searchCatalog } from './catalog.js'

/* ─────────────────────────── provider config ─────────────────────────── */

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
const GEMINI_MODEL = () => stripModelsPrefix(process.env.GEMINI_MODEL || 'gemini-3.5-flash')
const GEMINI_FALLBACK_MODEL = () =>
  stripModelsPrefix(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite')
const GEMINI_BASE = () =>
  (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
const GEMINI_THINKING = () => (process.env.GEMINI_THINKING_LEVEL ?? 'low').toLowerCase()

const DEEPSEEK_KEY = () => process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = () => (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const DEEPSEEK_MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-flash'
const DEEPSEEK_THINKING = () => (process.env.DEEPSEEK_THINKING || 'disabled').toLowerCase()

function stripModelsPrefix(model) {
  return String(model || '').replace(/^models\//, '')
}

/** Which provider will actually be used on the next call. */
export function activeProvider() {
  const forced = (process.env.AI_PROVIDER || 'auto').toLowerCase()
  if (forced === 'gemini' && GEMINI_KEY()) return 'gemini'
  if (forced === 'deepseek' && DEEPSEEK_KEY()) return 'deepseek'
  if (forced === 'local') return 'local'
  if (GEMINI_KEY()) return 'gemini'
  if (DEEPSEEK_KEY()) return 'deepseek'
  return 'local'
}

export const aiConfigured = () => activeProvider() !== 'local'

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
  { words: ['war', 'army', 'military'], type: 'genre', slug: 'war' },
  { words: ['series', 'tv show', 'tv-series', 'episodes'], type: 'genre', slug: 'tv-show' },
]

function matchSegments(message) {
  const text = String(message || '').toLowerCase()
  const found = []
  for (const entry of KEYWORD_MAP) {
    if (entry.words.some((w) => text.includes(w))) found.push(entry)
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

function relevanceFor(entry, segments, words) {
  let score = 0
  for (const seg of segments) {
    if (seg.filler) continue
    if (seg.type === 'country') {
      const re = COUNTRY_PATTERNS[seg.slug]
      if (re && re.test(entry.country || '')) score += 10
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

async function gatherCandidates(message, { referenceSlug } = {}) {
  const pages = []
  const segments = matchSegments(message)

  // Free-text search often catches the exact title the user mentions.
  const words = String(message)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 6)

  const searches = []
  if (words.length) searches.push(words.join(' '))
  // Individual words help when a phrase like "village thriller" matches
  // nothing as a whole but "village" exists as a title keyword.
  const GENERIC_WORDS = new Set(['family', 'comedy', 'action', 'drama', 'horror', 'romance', 'animation', 'kids'])
  for (const word of words.slice(0, 3)) {
    if (GENERIC_WORDS.has(word)) continue
    if (!searches.includes(word)) searches.push(word)
  }

  const searchPages = await Promise.all(
    searches.slice(0, 4).map(async (q) => {
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
  return rankCandidates(pool).slice(0, 150)
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

function buildPrompt({ message, candidates, memory, prefs, targetName, history = [], coverage = {} }) {
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
1. Return up to 15 titles exclusively from the VERIFIED CATALOG and aim for 10–15. Copy their slugs exactly. If the request is narrow (a specific country + format + audio) and fewer than 10 titles genuinely match, return only the ones that truly match (at least 5) and say the choice is small. NEVER pad the list with titles from another country, genre, audience or format just to reach ten.
2. Explain each pick in 1-2 short sentences ("why"), referencing genre, mood, country, IMDb rating if known, or audio info. Be concrete, not salesy.
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
${wantsBanglaVoice ? '12. The viewer chose a Bengali speaking voice. Also write "replyBn": the same short introduction in natural Bengali (বাংলা script) for text-to-speech — 1 to 2 warm sentences, no transliteration, no English sentences, no markdown. Keep it faithful to "reply".' : ''}

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

VERIFIED CATALOG (slug :: title):
${candidateLines}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: message },
  ]
}

/* ── Gemini (free tier) ─────────────────────────────────────────────────── */

async function callGeminiOnce(model, system, user, { withThinking }) {
  const generationConfig = {
    temperature: 0.45,
    maxOutputTokens: 3072,
    responseMimeType: 'application/json',
  }
  const level = GEMINI_THINKING()
  if (withThinking && level) generationConfig.thinkingConfig = { thinkingLevel: level }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45000)
  let res
  try {
    res = await fetch(`${GEMINI_BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_KEY(),
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
    const failure = new Error(`Gemini ${res.status} (${model}): ${detail}`)
    failure.status = res.status
    throw failure
  }

  const data = JSON.parse(text)
  const parts = data?.candidates?.[0]?.content?.parts || []
  const content = parts.map((p) => p?.text || '').join('').trim()
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
    if (err.status === 400 && /thinking/i.test(err.message)) {
      return await callGeminiOnce(model, system, user, { withThinking: false })
    }
    throw err
  }
}

async function callGemini(system, user) {
  const primary = GEMINI_MODEL()

  try {
    return await callGeminiModel(primary, system, user)
  } catch (primaryError) {
    // Free-tier models can be overloaded (503) or quota-limited (429). The Lite
    // model has a separate, very reliable free quota — use it as a safety net.
    const fallback = GEMINI_FALLBACK_MODEL()
    const retriable =
      [404, 429, 503].includes(primaryError.status) || /high demand|overload/i.test(primaryError.message)

    if (fallback && fallback !== primary && retriable) {
      try {
        return await callGeminiModel(fallback, system, user)
      } catch (fallbackError) {
        throw new Error(`${primaryError.message} → fallback ${fallbackError.message}`)
      }
    }

    throw primaryError
  }
}

/* ── DeepSeek (optional) ────────────────────────────────────────────────── */

async function callDeepSeek(messages) {
  if (!DEEPSEEK_KEY()) throw new Error('DEEPSEEK_API_KEY is not configured')

  const body = {
    model: DEEPSEEK_MODEL(),
    messages,
    temperature: 0.45,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    stream: false,
  }
  if (DEEPSEEK_THINKING() !== 'enabled') body.thinking = { type: 'disabled' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45000)
  let res
  try {
    res = await fetch(`${DEEPSEEK_BASE()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_KEY()}`,
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
    throw new Error(`DeepSeek ${res.status}: ${detail}`)
  }

  const data = JSON.parse(text)
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek returned an empty response')
  return content
}

/* ── dispatcher ─────────────────────────────────────────────────────────── */

async function callModel(messages) {
  const provider = activeProvider()
  if (provider === 'local') throw new Error('No AI key configured')

  if (provider === 'gemini') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const user = messages.find((m) => m.role === 'user')?.content || ''
    return callGemini(system, user)
  }

  return callDeepSeek(messages)
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

/* ───────────────────────── local fallback ───────────────────────── */

function localRecommend(message, candidates, memory, prefs, { aiAttempted = false, targetName = null } = {}) {
  const likedGenres = new Map(
    Object.entries(memory?.taste?.genres || {}).sort((a, b) => b[1] - a[1]).slice(0, 6),
  )
  const lowered = String(message || '').toLowerCase()
  const familyWords = /family|kids|children|cartoon|animated|family-friendly/.test(lowered)
  const wantsNew = /new|not watched|unwatched|haven'?t|already watched|exclude/.test(lowered)
  const wantsHindi = /hindi|dubbed/.test(lowered)
  const wantsKorean = /korean|korea|kdrama|k-drama/.test(lowered)
  const wantsThriller = /thriller|suspense/.test(lowered)
  const wantsSeries = /series|tv show|episodes|season|web series/.test(lowered)
  const watchedSlugs = new Set((memory?.watched || []).map((x) => x.slug))

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

  const wanted = [wantsKorean ? 'Korean titles' : null, wantsThriller ? 'thriller' : null, wantsHindi ? 'Hindi audio' : null]
    .filter(Boolean)
    .join(' · ')

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
  const gatheringText = topic ? `${topic} ${text}` : text
  const gathered = await gatherCandidates(gatheringText, { referenceSlug })
  const candidates = avoid.size ? gathered.filter((c) => !avoid.has(c.slug)) : gathered
  if (!candidates.length) {
    return {
      reply:
        "I couldn't find alternative titles for that request. Try widening the genre, country or year.",
      picks: [],
      followups: ['Try another genre', 'Something family-friendly', 'Korean thriller'],
      source: 'local',
      candidates: 0,
    }
  }

  const candidateMap = new Map(candidates.map((c) => [c.slug, c]))

  // ── request coverage ─────────────────────────────────────────────────────
  // The catalog is movie-heavy and has no real TV-series section, so the model
  // must know that up front instead of pretending or swapping in random titles.
  const wantsSeries = /\b(web[\s-]?series|tv[\s-]?series|tv[\s-]?show|series|seasons?|episodes?)\b/i.test(
    text,
  )
  const seriesCount = candidates.filter((c) => c.series).length
  const coverage = { wantsSeries, seriesCount }
  const focusCountries = matchSegments(gatheringText).filter(
    (segment) => !segment.filler && segment.type === 'country',
  )

  if (!aiConfigured()) {
    const local = localRecommend(text, candidates, memory, prefs, { targetName })
    const picks = await hydratePicks(local.picks, candidateMap)
    return { ...local, picks: polishLocalPicks(picks, text), source: 'local', candidates: candidates.length }
  }

  let parsed
  try {
    const content = await callModel(
      buildPrompt({ message: text, candidates, memory, prefs, targetName, history, coverage }),
    )
    parsed = parseJsonLoose(content)
  } catch (err) {
    // Fall back gracefully rather than breaking the TV experience.
    const local = localRecommend(text, candidates, memory, prefs, { aiAttempted: true, targetName })
    const picks = await hydratePicks(local.picks, candidateMap)
    return {
      ...local,
      reply: `${local.reply} Reason: ${err.message.slice(0, 160)}`,
      picks: polishLocalPicks(picks, text),
      source: 'local',
      candidates: candidates.length,
      aiError: err.message,
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
    model: aiMeta().model,
    provider: activeProvider(),
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
  const provider = activeProvider()
  return {
    provider,
    model: provider === 'gemini' ? GEMINI_MODEL() : provider === 'deepseek' ? DEEPSEEK_MODEL() : '',
    configured: provider !== 'local',
    baseUrl: provider === 'gemini' ? GEMINI_BASE() : provider === 'deepseek' ? DEEPSEEK_BASE() : '',
  }
}
