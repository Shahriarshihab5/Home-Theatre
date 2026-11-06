/**
 * CircleFTP catalog service.
 *
 * Verified structure (Nov 2026):
 *  - Listings:  http://hd.circleftp.net/genre/{slug}.html       (24 per page)
 *               http://hd.circleftp.net/country/{slug}.html
 *               Pagination: /genre/{slug}/{offset}.html  (offset = 24, 48, ...)
 *  - Search:    http://hd.circleftp.net/search.html?q=...
 *  - Detail:    http://hd.circleftp.net/watch/{slug}.html
 *               -> title, description, genres, country, release, duration,
 *                  quality, IMDb rating, direct stream source(s), servers, download link
 *  - Streams:   http://ftpN.circleftp.net/FILE/...  (HTTP only, Range supported)
 *  - Images:    http://hd.circleftp.net/uploads/video_thumb/{id}.jpg
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.CATALOG_BASE || 'http://hd.circleftp.net').replace(/\/$/, '')
const UA =
  'Mozilla/5.0 (Linux; Android 11; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 HomeMovieTheatre/1.0'

const LIST_TTL = 30 * 60 * 1000 // 30 min
const DETAIL_TTL = (Number(process.env.DETAIL_TTL_MINUTES) || 720) * 60 * 1000
const SEARCH_TTL = 15 * 60 * 1000
const HOME_TTL = 5 * 60 * 1000
const HINDI_TTL = 60 * 1000

const cache = new Map() // key -> { at, ttl, data }
const inflight = new Map()

function cacheGet(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data
  return undefined
}

function cacheSet(key, ttl, data) {
  cache.set(key, { at: Date.now(), ttl, data })
  if (cache.size > 900) {
    const cutoff = Date.now() - 12 * 60 * 60 * 1000
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
  }
  return data
}

export async function cached(key, ttl, loader) {
  const hit = cacheGet(key)
  if (hit !== undefined) return hit
  if (inflight.has(key)) return inflight.get(key)
  const p = (async () => {
    try {
      const data = await loader()
      return cacheSet(key, ttl, data)
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

export async function fetchPage(path, timeoutMs = 15000) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`CircleFTP responded ${res.status} for ${url}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/* ───────────────────────────── parsing helpers ─────────────────────────── */

const ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

export function decodeEntities(value) {
  if (!value) return ''
  let out = String(value)
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v)
  return out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim()
}

export function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function normalizeTitle(raw) {
  return decodeEntities(stripTags(raw))
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
}

export function slugFromLink(href) {
  const m = String(href || '').match(/\/watch\/([a-z0-9-]+)\.html/i)
  return m ? m[1] : ''
}

export function thumbFor(slug, html) {
  // Prefer the poster from the og:image / video_thumb referenced on the page.
  const og = html && html.match(/property="og:image"\s+content="([^"]+)"/i)
  if (og) return og[1]
  const m = html && html.match(/\/uploads\/video_thumb\/(\d+)\.jpg/)
  return m ? `${BASE}/uploads/video_thumb/${m[1]}.jpg` : ''
}

/**
 * Parse the movie tiles used across listings, search results, the homepage and
 * "You May Like" blocks. The site consistently uses:
 *   <div class="movie-img"> <img ... data-src="THUMB" alt="TITLE">
 *     <a href=".../watch/SLUG.html" class="ico-play ...">
 *     ... <div class="video_quality">...LABEL...</div>
 *     <div class="movie-title"><h3><a href=".../watch/SLUG.html">TITLE</a></h3></div>
 */
export function parseList(html) {
  const items = []
  const seen = new Set()
  if (!html) return items

  // 1) Tile blocks.
  const blocks = String(html).split(/<div class="movie-img"/i).slice(1)
  for (const block of blocks) {
    const slice = block.slice(0, 1400)
    const slug = slugFromLink(slice)
    if (!slug || seen.has(slug)) continue

    const img = slice.match(/<img[^>]*>/i)
    const imgTag = img ? img[0] : ''
    const thumb =
      (imgTag.match(/data-src="([^"]+)"/i) || [])[1] ||
      (imgTag.match(/\ssrc="([^"]+)"/i) || [])[1] ||
      ''
    const alt = (imgTag.match(/alt="([^"]*)"/i) || [])[1] || ''
    const titleLink = slice.match(/class="movie-title"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    const title = normalizeTitle(titleLink ? titleLink[1] : alt)
    const quality = (slice.match(/video_quality[\s\S]*?<span[^>]*>([^<]+)</i) || [])[1] || ''

    items.push({
      slug,
      title: title || alt || slug,
      thumb: thumb ? decodeEntities(thumb) : '',
      quality: quality ? stripTags(quality) : undefined,
    })
    seen.add(slug)
  }

  // 2) Fallback for simpler grids: any watch link with visible text.
  if (items.length === 0) {
    const re = /<a[^>]+href="[^"]*\/watch\/([a-z0-9-]+)\.html"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = re.exec(String(html)))) {
      const slug = m[1]
      const text = normalizeTitle(m[2])
      if (!text || seen.has(slug)) continue
      items.push({ slug, title: text, thumb: thumbFor(slug, html) })
      seen.add(slug)
    }
  }

  return items
}

/** Detect pagination from known markup: <li><a href=".../24.html" data-ci-pagination-page="2"> */
export function parsePagination(html, type, slug) {
  const offsets = new Set()
  const re = new RegExp(`/${type}/${slug}/(\\d+)\\.html`, 'gi')
  let m
  while ((m = re.exec(String(html)))) offsets.add(Number(m[1]))
  const sorted = [...offsets].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  return {
    offsets: sorted,
    totalPages: sorted.length ? Math.floor(sorted[sorted.length - 1] / 24) + 1 : 1,
    hasMore: sorted.length > 0,
  }
}

export function parseDetail(html, slug) {
  if (!html) return null

  const meta = (prop) => {
    const m = html.match(new RegExp(`property="${prop}"\\s+content="([^"]*)"`, 'i'))
    return m ? decodeEntities(m[1]) : ''
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = normalizeTitle(meta('og:title') || (h1 ? h1[1] : '') || slug)
  const description = stripTags(meta('og:description')) || ''
  const thumb = meta('og:image') || thumbFor(slug, html)

  const infoBlock = (html.match(/<div id="info"[\s\S]*?<div id="download"/i) || [])[0] || html

  const pickLinks = (label) => {
    const m = infoBlock.match(new RegExp(`${label}:\\s*</strong>([\\s\\S]*?)</p>`, 'i'))
    if (!m) return []
    const out = []
    const re = /<a[^>]*>([\s\S]*?)<\/a>/gi
    let x
    while ((x = re.exec(m[1]))) {
      const v = stripTags(x[1])
      if (v) out.push(v)
    }
    return out
  }

  const genres = pickLinks('Genre')
  const country = pickLinks('Country')[0] || ''
  const releaseDate = (infoBlock.match(/Release:\s*<\/strong>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1] || ''
  const duration = stripTags((infoBlock.match(/Duration:\s*<\/strong>\s*([^<]+)/i) || [])[1] || '')
  const quality = stripTags((infoBlock.match(/Quality:\s*<\/strong>\s*<span[^>]*>([^<]+)/i) || [])[1] || '')
  const imdbRaw = (infoBlock.match(/imdb-logo[^>]*>[^<]*<\/strong>\s*([0-9.]+)/i) || [])[1]
  const imdbRating = imdbRaw && Number(imdbRaw) > 0 ? Number(imdbRaw) : null

  // Direct stream sources: sources: [ { src: '...', type: 'video/mp4' } ]
  const sourcesBlock = (html.match(/sources:\s*\[([\s\S]*?)\]/i) || [])[1] || ''
  const sources = []
  const srcRe = /src:\s*'([^']+)'\s*,\s*type:\s*'([^']+)'/gi
  let s
  while ((s = srcRe.exec(sourcesBlock))) sources.push({ url: decodeEntities(s[1]), type: s[2] })

  // Alternative servers / episodes
  const seasonBlock = (html.match(/class="season"([\s\S]*?)<\/div>/i) || [])[1] || ''
  const altServers = []
  const serverRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let sv
  while ((sv = serverRe.exec(seasonBlock))) {
    const label = stripTags(sv[2])
    if (!label) continue
    altServers.push({ label, url: decodeEntities(sv[1]) })
  }

  // Download tab link
  const downloadBlock = (html.match(/<div id="download"[\s\S]*?>([\s\S]*?)<\/div>/i) || [])[1] || ''
  const downloadUrl = decodeEntities((downloadBlock.match(/href="([^"]+)"/i) || [])[1] || '')

  const itemId = (html.match(/wish_list_add\('fav','(\d+)'\)/) || [])[1] || ''
  const year =
    Number((title.match(/\((\d{4})\)/) || [])[1]) ||
    Number((releaseDate || '').slice(0, 4)) ||
    null

  const audio = parseAudio(sources[0]?.url || '', title, html)
  const related = parseList(html).filter((x) => x.slug !== slug).slice(0, 12)

  return {
    slug,
    title,
    thumb,
    description,
    genres,
    country,
    releaseDate,
    year,
    duration,
    quality,
    imdbRating,
    sources,
    altServers,
    downloadUrl,
    watchUrl: `${BASE}/watch/${slug}.html`,
    audio,
    related,
    itemId,
    fetchedAt: Date.now(),
  }
}

const LANGUAGE_WORDS = [
  'Hindi',
  'Tamil',
  'Telugu',
  'Malayalam',
  'Kannada',
  'Bengali',
  'Punjabi',
  'Marathi',
  'English',
  'Urdu',
  'Korean',
  'Japanese',
  'Chinese',
  'Thai',
  'Turkish',
]

/**
 * Audio info is derived honestly from the stream filename / release tag, e.g.
 * "... [Dual Audio] [Hindi+Tamil] x264.mkv" or ".../Hindi Dubbed/...".
 * Bracket tags on the file name are authoritative; folder names are only a
 * fallback hint. The browser cannot always switch MKV audio tracks, so this is
 * a *label*, not a promise of track selection.
 */
export function parseAudio(sourceUrl, title = '', html = '') {
  let decoded = ''
  try {
    decoded = decodeURIComponent(String(sourceUrl || ''))
  } catch {
    decoded = String(sourceUrl || '')
  }

  const fileName = decoded.split('/').pop() || ''
  const tags = [...fileName.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).join(' ')
  const tagSource = `${tags} ${fileName}`.toLowerCase()
  const fullSource = decoded.toLowerCase()

  const languagesIn = (haystack) =>
    LANGUAGE_WORDS.filter((lang) => new RegExp(`\\b${lang.toLowerCase()}\\b`).test(haystack))

  // Prefer the explicit [tags] on the file; fall back to the whole path.
  let languages = languagesIn(tagSource)
  if (!languages.length) languages = languagesIn(fullSource)

  const hindiDubbed = /hindi[\s_-]*dubbed/i.test(fullSource)
  if (hindiDubbed && !languages.includes('Hindi')) languages = ['Hindi', ...languages]

  const dual = /dual\s*audio|multi[-\s]?audio/i.test(`${tagSource} ${fullSource}`)

  let label = 'Audio tracks not listed'
  if (languages.length) label = languages.join(' + ')
  if (dual) label += ' · Dual audio'

  return {
    languages,
    dual,
    hindi: languages.includes('Hindi'),
    label,
    // "verified" = we saw it in the filename/tags of the actual source.
    verified: Boolean(sourceUrl && languages.length),
  }
}

/* ───────────────────────────── public API ─────────────────────────────── */

export async function getListing(type, slug, offset = 0) {
  if (!['genre', 'country'].includes(type)) throw new Error('Invalid listing type')
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid listing slug')
  const off = Math.max(0, Math.floor(Number(offset) / 24) * 24)
  const path = off > 0 ? `/${type}/${slug}/${off}.html` : `/${type}/${slug}.html`

  return cached(`list:${type}:${slug}:${off}`, LIST_TTL, async () => {
    const html = await fetchPage(path)
    const items = parseList(html)
    const pagination = parsePagination(html, type, slug)
    return {
      type,
      slug,
      offset: off,
      items,
      hasMore: pagination.offsets.some((o) => o > off) || (pagination.offsets.length === 0 && items.length >= 24),
      nextOffset: pagination.offsets.find((o) => o > off) || (items.length >= 24 ? off + 24 : null),
      advisory:
        type === 'country' && slug === 'korean'
          ? 'Korean titles are listed here, but audio language is only confirmed on each title page.'
          : undefined,
    }
  })
}

export async function searchCatalog(query) {
  const q = String(query || '').trim()
  if (!q) return { query: '', items: [] }
  return cached(`search:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    const html = await fetchPage(`/search.html?q=${encodeURIComponent(q)}`)
    return { query: q, items: parseList(html) }
  })
}

export async function getDetail(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || '')) throw new Error('Invalid title slug')
  return cached(`detail:${slug}`, DETAIL_TTL, async () => {
    const html = await fetchPage(`/watch/${slug}.html`)
    const detail = parseDetail(html, slug)
    if (!detail) throw new Error('Could not parse title page')
    return detail
  })
}

/** Detail cache peek (no network) – used for rows like Top Rated / Hindi picks. */
export function peekDetail(slug) {
  return cacheGet(`detail:${slug}`)
}

export function cachedDetails() {
  const out = []
  for (const [key, entry] of cache) {
    if (key.startsWith('detail:') && entry.data?.slug && Date.now() - entry.at < entry.ttl) {
      out.push(entry.data)
    }
  }
  return out
}

/* ───────────────────── enrichment & taste rows ───────────────────── */

const SERIES_RE = /tv[\s-]?series|tv[\s-]?show|web[\s-]?series|season\s*\d|episode\s*\d/i

/** A title is treated as a web series when its genres or name say so. */
export function isSeriesDetail(detail) {
  if (!detail) return false
  if ((detail.genres || []).some((g) => /tv[\s-]?series|tv[\s-]?show|series|soap/i.test(g))) return true
  return SERIES_RE.test(detail.title || '')
}

/** Compact card shape used by every row (includes verified metadata when known). */
export function toCard(detail) {
  return {
    slug: detail.slug,
    title: detail.title,
    thumb: detail.thumb || '',
    quality: detail.quality || undefined,
    imdbRating: detail.imdbRating ?? null,
    audioLabel: detail.audio?.label,
    audio: detail.audio || null,
    genres: detail.genres || [],
    country: detail.country || '',
  }
}

/**
 * Add genres/country/audio/rating to a listing item when its detail page has
 * already been scanned. Costs nothing (memory cache only, no network).
 */
export function enrichItem(item) {
  if (!item?.slug) return item
  const d = peekDetail(item.slug)
  if (!d) return item
  return {
    ...item,
    thumb: item.thumb || d.thumb || '',
    quality: item.quality || d.quality,
    imdbRating: d.imdbRating ?? item.imdbRating ?? null,
    audioLabel: item.audioLabel || d.audio?.label,
    audio: d.audio || item.audio || null,
    genres: d.genres || item.genres || [],
    country: d.country || item.country || '',
  }
}

function dedupeCards(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (!item?.slug || seen.has(item.slug)) continue
    seen.add(item.slug)
    out.push(item)
  }
  return out
}

/** Hindi movies + web series, confirmed from the stream's own audio label. */
export async function getHindiSections() {
  // First visit on a cold server: make sure a scan is running.
  if (cachedDetails().length === 0) startWarmup().catch(() => {})
  warmHindi().catch(() => {})

  return cached('hindi', HINDI_TTL, async () => {
    const all = cachedDetails()
    const details = all.filter((d) => d.audio?.hindi && d.sources?.length)
    const movies = dedupeCards(details.filter((d) => !isSeriesDetail(d)).map(toCard)).slice(0, 60)
    const series = dedupeCards(details.filter(isSeriesDetail).map(toCard)).slice(0, 60)
    return {
      movies,
      series,
      scanned: all.length,
      updatedAt: Date.now(),
    }
  })
}

/** Scan a wider slice of Indian / TV listings so Hindi rows have real depth. */
let hindiWarmPromise = null
function warmHindi() {
  if (hindiWarmPromise) return hindiWarmPromise
  hindiWarmPromise = (async () => {
    const pages = await Promise.all([
      getListing('country', 'india', 0).catch(() => null),
      getListing('genre', 'tv-show', 0).catch(() => null),
      getListing('genre', 'romance', 0).catch(() => null),
    ])
    const slugs = dedupeCards(
      pages.filter(Boolean).flatMap((p) => (p.items || []).map((i) => ({ slug: i.slug }))),
    )
      .filter((i) => !peekDetail(i.slug))
      .slice(0, 36)
      .map((i) => i.slug)

    await warmDetails(slugs, 3).catch(() => {})
    // Force the Hindi aggregate to rebuild once the scan completes.
    cache.delete('hindi')
    return slugs.length
  })()
  return hindiWarmPromise
}

/**
 * Re-rank the whole home pool against a profile's learned taste.
 * Sent by the client so each family member gets a different order.
 */
export async function forYou(taste = {}, { exclude = [] } = {}) {
  const [home, hindi] = await Promise.all([getHome(), getHindiSections()])
  const pool = dedupeCards([
    ...(hindi.movies || []),
    ...(hindi.series || []),
    ...(home.topRated || []),
    ...(home.latest || []),
    ...(home.korean || []),
    ...(home.family || []),
  ]).map(enrichItem)

  const genres = taste?.genres || {}
  const countries = taste?.countries || {}
  const hasTaste = Object.keys(genres).length > 0 || Object.keys(countries).length > 0
  const excluded = new Set(exclude)

  const ranked = pool
    .filter((item) => !excluded.has(item.slug))
    .map((item) => {
      let score = 0
      for (const genre of item.genres || []) score += genres[genre] || 0
      if (item.country) score += (countries[item.country] || 0) * 0.8
      if (typeof item.imdbRating === 'number') score += (item.imdbRating - 6) * 0.6
      return { item, score }
    })
    .sort((a, b) => b.score - a.score)

  return {
    items: ranked.slice(0, 30).map(({ item }) => item),
    tasteSignals: hasTaste,
    pool: pool.length,
    updatedAt: Date.now(),
  }
}

async function mapConcurrent(list, limit, fn) {
  const results = new Array(list.length)
  let i = 0
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++
      try {
        results[idx] = await fn(list[idx], idx)
      } catch {
        results[idx] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Home aggregate. Built from verified listing pages only — every title is a real
 * CircleFTP entry. Rows that require detail data (Top Rated, Hindi confirmed)
 * warm in the background and appear as soon as data is ready.
 */
export async function getHome() {
  return cached('home', HOME_TTL, async () => {
    const jobs = {
      tvSeries: getListing('genre', 'tv-series', 0).catch(() => ({ items: [] })),
      tvShows: getListing('genre', 'tv-show', 0).catch(() => ({ items: [] })),
      popular: getListing('genre', 'action', 0).catch(() => ({ items: [] })),
      korean: getListing('country', 'korean', 0).catch(() => ({ items: [] })),
      family: getListing('genre', 'family', 0).catch(() => ({ items: [] })),
      animation: getListing('genre', 'animation', 0).catch(() => ({ items: [] })),
      drama: getListing('genre', 'drama', 0).catch(() => ({ items: [] })),
      thriller: getListing('genre', 'thriller', 0).catch(() => ({ items: [] })),
      indian: getListing('country', 'india', 0).catch(() => ({ items: [] })),
    }

    const [tvSeries, tvShows, popular, korean, family, animation, drama, thriller, indian] =
      await Promise.all(Object.values(jobs))

    const dedupe = (rows, limit) => {
      const seen = new Set()
      const out = []
      for (const row of rows) {
        for (const item of row.items || []) {
          if (seen.has(item.slug)) continue
          seen.add(item.slug)
          out.push(item)
          if (out.length >= limit) return out
        }
      }
      return out
    }

    const details = cachedDetails()
    const topRated = details
      .filter((d) => d.imdbRating && d.sources?.length)
      .sort((a, b) => (b.imdbRating || 0) - (a.imdbRating || 0))
      .slice(0, 18)
      .map(toCard)

    const hindiDetails = details.filter((d) => d.audio?.hindi && d.sources?.length)
    const hindiMovies = dedupeCards(hindiDetails.filter((d) => !isSeriesDetail(d)).map(toCard)).slice(0, 24)
    const hindiSeries = dedupeCards(hindiDetails.filter(isSeriesDetail).map(toCard)).slice(0, 24)

    return {
      generatedAt: Date.now(),
      latest: dedupe([tvSeries, tvShows, popular, thriller, drama, indian], 24).map(enrichItem),
      korean: dedupe([korean], 24).map(enrichItem),
      koreanNote: 'Korean titles available in the catalog. Audio language is confirmed on each title page.',
      family: dedupe([family, animation], 24).map(enrichItem),
      topRated,
      topRatedNote: topRated.length
        ? 'IMDb ratings shown only for titles already scanned from CircleFTP.'
        : 'Still scanning IMDb ratings for available titles…',
      hindiMovies,
      hindiSeries,
      hindiConfirmed: [...hindiMovies, ...hindiSeries].slice(0, 18),
      hindiNote: 'Titles whose stream filename explicitly lists Hindi audio.',
      sections: {
        latest: 'Recently Added',
        popular: 'Popular in Action',
        korean: 'Korean Titles',
        family: 'Family Night',
        drama: 'Drama',
        indian: 'Indian Cinema',
      },
    }
  })
}

/** Warm details for a list of slugs (concurrency-limited, silent). */
export async function warmDetails(slugs, limit = 4) {
  await mapConcurrent([...new Set(slugs)], limit, (slug) => getDetail(slug).catch(() => null))
}

/** Start background warming so Top Rated / Hindi rows populate. Guarded to run once per process. */
let warmupPromise = null
export function startWarmup() {
  if (warmupPromise) return warmupPromise
  warmupPromise = (async () => {
  const seeds = []
  const jobs = [
    ['genre', 'action'],
    ['genre', 'drama'],
    ['genre', 'thriller'],
    ['genre', 'comedy'],
    ['genre', 'family'],
    ['genre', 'animation'],
    ['genre', 'tv-series'],
    ['country', 'korean'],
    ['country', 'india'],
    ['country', 'tamil'],
    ['country', 'usa'],
    ['country', 'south-korea'],
  ]
  for (const [type, slug] of jobs) {
    try {
      const page = await getListing(type, slug, 0)
      seeds.push(...page.items.slice(0, 15).map((i) => i.slug))
    } catch {
      /* ignore unavailable listings */
    }
  }
  const unique = [...new Set(seeds)].slice(0, 90)
  // Fire and forget; keep load on CircleFTP gentle.
  warmDetails(unique, 3).catch(() => {})
  return unique.length
  })()
  return warmupPromise
}

export const catalogMeta = { base: BASE }
