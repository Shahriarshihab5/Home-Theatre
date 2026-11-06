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

const IS_SERVERLESS = Boolean(process.env.VERCEL)

/**
 * CircleFTP only answers from its own network, so a cloud host cannot browse it
 * live. In that case we serve a snapshot of the catalog that ships with the
 * repo (server/data/catalog-snapshot.json): browsing, search and AI picks keep
 * working anywhere; playback still needs the home network.
 *
 * Set CATALOG_MODE=live to force live crawling (e.g. behind a tunnel), or
 * CATALOG_MODE=snapshot to force the snapshot locally.
 */
const OFFLINE_MODE =
  process.env.CATALOG_MODE === 'snapshot' ||
  (IS_SERVERLESS && process.env.CATALOG_MODE !== 'live')

export const offlineMode = () => OFFLINE_MODE

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

  if (OFFLINE_MODE) return snapshotListing(type, slug, off)

  return cached(`list:${type}:${slug}:${off}`, LIST_TTL, async () => {
    try {
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
    } catch (err) {
      // Home network hiccup: a saved listing is better than an empty screen.
      const saved = snapshotListing(type, slug, off)
      if (saved.items.length) return { ...saved, fallback: true }
      throw err
    }
  })
}

export async function searchCatalog(query) {
  const q = String(query || '').trim()
  if (!q) return { query: '', items: [] }
  if (OFFLINE_MODE) return snapshotSearch(q)

  return cached(`search:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    try {
      const html = await fetchPage(`/search.html?q=${encodeURIComponent(q)}`)
      return { query: q, items: parseList(html) }
    } catch (err) {
      const saved = snapshotSearch(q)
      if (saved.items.length) return { ...saved, fallback: true }
      throw err
    }
  })
}

export async function getDetail(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || '')) throw new Error('Invalid title slug')
  return cached(`detail:${slug}`, DETAIL_TTL, async () => {
    if (OFFLINE_MODE) {
      const entry = qualityIndex.get(slug)
      if (!entry) throw new Error('This title is not in the saved catalog snapshot.')
      return detailFromIndex(entry)
    }
    try {
      const html = await fetchPage(`/watch/${slug}.html`)
      const detail = parseDetail(html, slug)
      if (!detail) throw new Error('Could not parse title page')
      rememberDetail(detail)
      return detail
    } catch (err) {
      // Still show what we already know about the title (rating, genres, poster).
      const entry = qualityIndex.get(slug)
      if (entry) return detailFromIndex(entry)
      throw err
    }
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

const SERIES_RE = /tv[\s-]?series|tv[\s-]?show|web[\s-]?series/i

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
  if (OFFLINE_MODE) {
    return cached('hindi:snapshot', HOME_TTL, async () => {
      const all = snapshotEntries()
      const hindi = all.filter((e) => e.hindi).sort(byRating)
      return {
        movies: hindi.filter((e) => !e.series).slice(0, 60).map(snapshotCard),
        series: hindi.filter((e) => e.series).slice(0, 60).map(snapshotCard),
        scanned: all.length,
        updatedAt: Date.now(),
        snapshot: true,
      }
    })
  }

  // First visit on a cold server: make sure a scan is running.
  if (cachedDetails().length === 0) startWarmup().catch(() => {})
  warmHindi().catch(() => {})

  return cached('hindi', HINDI_TTL, async () => {
    const all = cachedDetails()
    const live = all.filter((d) => d.audio?.hindi && d.sources?.length)
    // Cold start: show the saved snapshot immediately instead of an empty row.
    if (!live.length) {
      const hindi = snapshotEntries().filter((e) => e.hindi).sort(byRating)
      if (hindi.length) {
        return {
          movies: hindi.filter((e) => !e.series).slice(0, 60).map(snapshotCard),
          series: hindi.filter((e) => e.series).slice(0, 60).map(snapshotCard),
          scanned: all.length,
          updatedAt: Date.now(),
          snapshot: true,
        }
      }
    }
    const movies = dedupeCards(live.filter((d) => !isSeriesDetail(d)).map(toCard)).slice(0, 60)
    const series = dedupeCards(live.filter(isSeriesDetail).map(toCard)).slice(0, 60)
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
  if (OFFLINE_MODE) return cached('home:snapshot', HOME_TTL, async () => snapshotHome())

  return cached('home', HOME_TTL, async () => {
    const ignore = { items: [], __failed: true }
    const jobs = {
      tvSeries: getListing('genre', 'tv-series', 0).catch(() => ignore),
      tvShows: getListing('genre', 'tv-show', 0).catch(() => ignore),
      popular: getListing('genre', 'action', 0).catch(() => ignore),
      korean: getListing('country', 'korean', 0).catch(() => ignore),
      family: getListing('genre', 'family', 0).catch(() => ignore),
      animation: getListing('genre', 'animation', 0).catch(() => ignore),
      drama: getListing('genre', 'drama', 0).catch(() => ignore),
      thriller: getListing('genre', 'thriller', 0).catch(() => ignore),
      indian: getListing('country', 'india', 0).catch(() => ignore),
    }

    const [tvSeries, tvShows, popular, korean, family, animation, drama, thriller, indian] =
      await Promise.all(Object.values(jobs))

    const outcomes = [tvSeries, tvShows, popular, korean, family, animation, drama, thriller, indian]
    if (outcomes.every((page) => page.__failed)) {
      // Live site unreachable (home network down). The saved catalog still
      // gives a useful home screen instead of a blank error page.
      const saved = snapshotHome()
      if (saved.topRated.length || saved.latest.length) return { ...saved, fallback: true }
      throw new Error(
        'This server cannot reach hd.circleftp.net. CircleFTP only answers requests from its own network, so cloud hosts (Vercel) cannot load the catalog — run the app on a device on your home Wi-Fi.',
      )
    }

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
    const topRated = topRatedIndex({ limit: 18, min: 7.0 })

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
  if (OFFLINE_MODE) return Promise.resolve(0)
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

/* ═══════════════════════ persistent quality index ═══════════════════════ */
/**
 * Every detail page we ever fetch teaches us the real IMDb rating, genres,
 * country and audio label for that title. We keep those in a JSON file so the
 * knowledge survives restarts and keeps growing instead of being thrown away.
 *
 * This is what lets the AI rank by quality ("prefer 7+") instead of guessing
 * from titles alone.
 */

const DATA_DIR = path.join(__dirname, '..', 'data')
const INDEX_FILE = path.join(DATA_DIR, 'catalog-index.json')
const SNAPSHOT_FILE = path.join(__dirname, 'data', 'catalog-snapshot.json')
const INDEX_TTL = 30 * 24 * 60 * 60 * 1000

const qualityIndex = new Map() // slug -> entry

function toIndexEntry(detail) {
  return {
    slug: detail.slug,
    title: detail.title,
    year: detail.year ?? null,
    imdb: detail.imdbRating ?? null,
    genres: detail.genres || [],
    country: detail.country || '',
    audio: detail.audio?.label || '',
    hindi: Boolean(detail.audio?.hindi),
    thumb: detail.thumb || '',
    quality: detail.quality || '',
    series: isSeriesDetail(detail),
    at: Date.now(),
  }
}

/** Record a freshly parsed detail page in the quality index. */
export function rememberDetail(detail) {
  if (!detail?.slug) return
  const previous = qualityIndex.get(detail.slug)
  const entry = toIndexEntry(detail)
  // Keep a previously known rating if this page somehow lacks one.
  if (entry.imdb == null && previous?.imdb != null) entry.imdb = previous.imdb
  qualityIndex.set(detail.slug, entry)
  scheduleIndexSave()
}

export function indexedTitles() {
  return [...qualityIndex.values()]
}

/** One learned entry (no network). */
export function indexEntry(slug) {
  return qualityIndex.get(String(slug || '')) || null
}

export function indexStats() {
  const all = [...qualityIndex.values()]
  const rated = all.filter((e) => typeof e.imdb === 'number' && e.imdb > 0)
  return {
    titles: all.length,
    rated: rated.length,
    avgRating: rated.length
      ? Math.round((rated.reduce((s, e) => s + e.imdb, 0) / rated.length) * 10) / 10
      : null,
    series: all.filter((e) => e.series).length,
    mode: OFFLINE_MODE ? 'snapshot' : 'live',
    crawl: { ...crawlState },
  }
}

/** Highest-rated titles we know about, optionally filtered. */
export function topRatedIndex({ limit = 60, min = 7.2, series = null } = {}) {
  return [...qualityIndex.values()]
    .filter((e) => typeof e.imdb === 'number' && e.imdb >= min)
    .filter((e) => (series === null ? true : e.series === series))
    .sort((a, b) => b.imdb - a.imdb)
    .slice(0, limit)
    .map((e) => ({
      slug: e.slug,
      title: e.title,
      thumb: e.thumb,
      quality: e.quality || undefined,
      imdbRating: e.imdb,
      audioLabel: e.audio || undefined,
      genres: e.genres,
      country: e.country,
    }))
}

/** Load the snapshot that ships with the repo (used by cloud hosts). */
function loadSnapshot() {
  let data = null
  try {
    data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
  } catch {
    try {
      data = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'catalog-snapshot.json'), 'utf8'))
    } catch {
      return
    }
  }
  const entries = Array.isArray(data?.entries) ? data.entries : []
  for (const entry of entries) {
    if (!entry?.slug) continue
    // Older summary data only; never overwrite tonight's live crawl.
    qualityIndex.set(String(entry.slug), { ...entry, at: data.generatedAt || 0, snapshot: true })
  }
  if (entries.length) console.log(`[index] snapshot: ${entries.length} titles available offline`)
}

function loadIndex() {
  loadSnapshot()
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8')
    const data = JSON.parse(raw)
    for (const entry of data?.entries || []) {
      if (entry?.slug) qualityIndex.set(String(entry.slug), entry)
    }
    if (qualityIndex.size) {
      console.log(`[index] loaded ${qualityIndex.size} known titles from disk`)
    }
  } catch {
    /* first run — no live index yet */
  }
}

let indexSaveTimer = null
let indexDirty = false

function scheduleIndexSave() {
  if (IS_SERVERLESS) return
  indexDirty = true
  if (indexSaveTimer) return
  indexSaveTimer = setTimeout(() => {
    indexSaveTimer = null
    if (indexDirty) saveIndexNow()
  }, 5000)
  indexSaveTimer.unref?.()
}

export function saveIndexNow() {
  if (IS_SERVERLESS) return false
  indexDirty = false
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const payload = JSON.stringify({ v: 1, at: Date.now(), entries: [...qualityIndex.values()] })
    const tmp = `${INDEX_FILE}.tmp`
    fs.writeFileSync(tmp, payload)
    fs.renameSync(tmp, INDEX_FILE)
    return true
  } catch (err) {
    console.warn('[index] could not save:', err.message)
    return false
  }
}

loadIndex()

/* ───────────────────── snapshot helpers (cloud / offline) ─────────────── */

function snapshotEntries() {
  return [...qualityIndex.values()]
}

const byRating = (a, b) => (b.imdb ?? -1) - (a.imdb ?? -1)

function snapshotCard(entry) {
  return {
    slug: entry.slug,
    title: entry.title,
    thumb: entry.thumb || '',
    quality: entry.quality || undefined,
    imdbRating: entry.imdb ?? null,
    audioLabel: entry.audio || undefined,
    genres: entry.genres || [],
    country: entry.country || '',
  }
}

const LISTING_COUNTRY = {
  india: /india/i,
  usa: /usa|united states/i,
  korean: /korea/i,
  'south-korea': /korea/i,
  tamil: /tamil/i,
  japan: /japan/i,
  china: /china/i,
  thailand: /thai/i,
  turkey: /turk/i,
  uk: /united kingdom|^uk$/i,
  france: /france/i,
  spain: /spain/i,
  germany: /german/i,
  russia: /russia/i,
  indonesia: /indonesia/i,
}

function genreMatches(entry, slug) {
  const genres = entry.genres || []
  if (slug === 'tv-series' || slug === 'tv-show' || /^tv[- ]?(series|show|soap)$/i.test(slug)) {
    return Boolean(entry.series) || genres.some((genre) => /tv|series|soap/i.test(genre))
  }
  if (/sci[- ]?fi/i.test(slug)) {
    return genres.some((genre) => /sci[- ]?fi|si[- ]?fi|science fiction/i.test(genre))
  }
  if (slug === 'family') return genres.some((genre) => /family|kids|animation/i.test(genre))
  if (slug === 'animation') return genres.some((genre) => /animation|anime/i.test(genre))
  const words = slug.split('-').filter(Boolean)
  return genres.some((genre) => {
    const lower = genre.toLowerCase()
    return words.every((word) => lower.includes(word))
  })
}

function matchesListing(entry, type, slug) {
  if (type === 'country') {
    const re = LISTING_COUNTRY[slug]
    if (re) return re.test(entry.country || '')
    return String(entry.country || '').toLowerCase().includes(slug.replace(/-/g, ' '))
  }
  return genreMatches(entry, slug)
}

function snapshotListing(type, slug, offset = 0) {
  const matches = snapshotEntries().filter((entry) => matchesListing(entry, type, slug)).sort(byRating)
  const next = offset + 24 < matches.length ? offset + 24 : null
  return {
    type,
    slug,
    offset,
    items: matches.slice(offset, offset + 24).map(snapshotCard),
    hasMore: next !== null,
    nextOffset: next,
    snapshot: true,
    advisory:
      type === 'country' && slug === 'korean'
        ? 'Korean titles from the saved catalog. Audio language is confirmed on each title page.'
        : undefined,
  }
}

function snapshotSearch(query) {
  const needle = String(query || '').toLowerCase().trim()
  if (!needle) return { query: '', items: [], snapshot: true }
  const words = needle.split(/\s+/).filter(Boolean)
  const scored = []
  for (const entry of snapshotEntries()) {
    const title = String(entry.title || '').toLowerCase()
    const meta = `${(entry.genres || []).join(' ')} ${entry.country || ''}`.toLowerCase()
    let score = 0
    if (title === needle) score = 120
    else if (title.startsWith(needle)) score = 90
    else if (title.includes(needle)) score = 70
    else if (words.length > 1 && words.every((word) => title.includes(word))) score = 50
    else if (meta.includes(needle)) score = 25
    if (!score) continue
    scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score || byRating(a.entry, b.entry))
  return {
    query,
    items: scored.slice(0, 60).map(({ entry }) => snapshotCard(entry)),
    snapshot: true,
    total: scored.length,
  }
}

/** A detail page reconstructed from the saved index (no stream source). */
function detailFromIndex(entry) {
  const related = snapshotEntries()
    .filter(
      (other) =>
        other.slug !== entry.slug &&
        (entry.genres || []).some((genre) => (other.genres || []).includes(genre)),
    )
    .sort(byRating)
    .slice(0, 12)
    .map(snapshotCard)

  return {
    slug: entry.slug,
    title: entry.title,
    thumb: entry.thumb || '',
    description: '',
    genres: entry.genres || [],
    country: entry.country || '',
    releaseDate: entry.year ? `${entry.year}-01-01` : '',
    year: entry.year ?? null,
    duration: '',
    quality: entry.quality || '',
    imdbRating: entry.imdb ?? null,
    sources: [],
    altServers: [],
    downloadUrl: '',
    watchUrl: `${BASE}/watch/${entry.slug}.html`,
    audio: {
      languages: [],
      dual: /dual|multi/i.test(entry.audio || ''),
      hindi: Boolean(entry.hindi),
      label: entry.audio || 'Audio tracks not listed',
      verified: false,
    },
    related,
    itemId: '',
    fetchedAt: Date.now(),
    snapshot: true,
  }
}

/** Home rows built from the saved catalog — instant, works on any host. */
function snapshotHome() {
  const all = snapshotEntries()
  const rated = all.filter((entry) => typeof entry.imdb === 'number' && entry.imdb > 0).sort(byRating)
  const hindi = all.filter((entry) => entry.hindi).sort(byRating)
  const latest = [...all]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.imdb ?? -1) - (a.imdb ?? -1))
    .slice(0, 24)
    .map(snapshotCard)
  const korean = all
    .filter((entry) => /korea/i.test(entry.country || ''))
    .sort(byRating)
    .slice(0, 24)
    .map(snapshotCard)
  const family = all
    .filter((entry) => (entry.genres || []).some((genre) => /family|animation|kids/i.test(genre)))
    .sort(byRating)
    .slice(0, 24)
    .map(snapshotCard)
  const hindiMovies = hindi.filter((entry) => !entry.series).slice(0, 24).map(snapshotCard)
  const hindiSeries = hindi.filter((entry) => entry.series).slice(0, 24).map(snapshotCard)

  return {
    generatedAt: Date.now(),
    latest,
    korean,
    koreanNote: 'Korean titles from the saved catalog. Audio language is confirmed on each title page.',
    family,
    topRated: topRatedIndex({ limit: 18, min: 7.0 }),
    topRatedNote: `Saved catalog snapshot: ${rated.length} of ${all.length} titles have real IMDb ratings${
      rated.length ? `, average ${(rated.reduce((sum, entry) => sum + entry.imdb, 0) / rated.length).toFixed(1)}` : ''
    }.`,
    hindiMovies,
    hindiSeries,
    hindiConfirmed: [...hindiMovies, ...hindiSeries].slice(0, 18),
    hindiNote: 'Titles whose stream filename explicitly lists Hindi audio.',
    snapshot: true,
    sections: {
      latest: 'Recently Added',
      popular: 'Popular in Action',
      korean: 'Korean Titles',
      family: 'Family Night',
      drama: 'Drama',
      indian: 'Indian Cinema',
    },
  }
}

/* ───────────────────────── background quality crawl ───────────────────── */

const CRAWL_GENRES = [
  'action', 'drama', 'thriller', 'comedy', 'romance', 'family', 'horror',
  'crime', 'mystery', 'sci-fi', 'animation', 'adventure', 'tv-series', 'fantasy',
]
const CRAWL_COUNTRIES = ['india', 'usa', 'korean', 'tamil', 'japan', 'china', 'thailand', 'turkey', 'uk']

const crawlState = {
  running: false,
  fetched: 0,
  pages: 0,
  startedAt: 0,
  finishedAt: 0,
  target: 0,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildCrawlTasks() {
  const tasks = []
  // Popular genres first — page 0 is newest, deeper pages are older catalog.
  for (const slug of CRAWL_GENRES) {
    for (const offset of [0, 24, 48, 96, 192]) tasks.push({ type: 'genre', slug, offset })
  }
  for (const slug of CRAWL_COUNTRIES) {
    for (const offset of [0, 24, 48]) tasks.push({ type: 'country', slug, offset })
  }
  // Year pages fill in older, often much better-rated classics.
  const thisYear = new Date().getFullYear()
  for (let year = thisYear; year >= 1960; year -= 1) {
    tasks.push({ type: 'year', slug: String(year), offset: 0 })
  }
  return tasks
}

let crawlPromise = null

/**
 * Walk CircleFTP listings and learn real IMDb ratings for as many titles as we
 * can, at a gentle, steady pace. Runs once per process, results persist to disk.
 */
export function startCrawl({ max = Number(process.env.CRAWL_MAX || 4000) } = {}) {
  if (crawlPromise) return crawlPromise
  if (IS_SERVERLESS || process.env.CRAWL_ENABLED === '0') return Promise.resolve(0)

  crawlPromise = (async () => {
    crawlState.running = true
    crawlState.startedAt = Date.now()
    crawlState.target = max

    const queue = []
    let producersDone = false
    let fetched = 0

    const detailWorkers = Array.from({ length: 4 }, async () => {
      for (;;) {
        if (!queue.length) {
          if (producersDone || fetched >= max) return
          await sleep(200)
          continue
        }
        if (fetched >= max) return
        const slug = queue.shift()
        const known = qualityIndex.get(slug)
        if (known && Date.now() - known.at < INDEX_TTL) continue
        try {
          await getDetail(slug)
          fetched += 1
          crawlState.fetched = fetched
          if (fetched % 100 === 0) {
            saveIndexNow()
            console.log(`[index] crawled ${fetched}/${max} titles (${qualityIndex.size} known)`)
          }
        } catch {
          /* skip unavailable titles */
        }
      }
    })

    const tasks = buildCrawlTasks()
    let cursor = 0

    // Year pages are fetched through the generic listing helper below.
    const loadTask = async (task) => {
      if (task.type === 'year') {
        const html = await fetchPage(`/year/${task.slug}.html`)
        return { items: parseList(html) }
      }
      return getListing(task.type, task.slug, task.offset)
    }

    const listingWorkers = Array.from({ length: 3 }, async () => {
      while (cursor < tasks.length && fetched < max) {
        if (queue.length > 500) {
          await sleep(250)
          continue
        }
        const task = tasks[cursor++]
        try {
          const page = await loadTask(task)
          crawlState.pages += 1
          for (const item of page.items || []) {
            const known = qualityIndex.get(item.slug)
            if (known && Date.now() - known.at < INDEX_TTL) continue
            queue.push(item.slug)
          }
        } catch {
          /* ignore unreachable listing */
        }
      }
    })

    await Promise.all(listingWorkers)
    producersDone = true
    await Promise.all(detailWorkers)

    crawlState.running = false
    crawlState.finishedAt = Date.now()
    saveIndexNow()
    console.log(`[index] crawl finished — ${qualityIndex.size} titles known`)
    return fetched
  })()

  return crawlPromise
}

export const catalogMeta = { base: BASE }
