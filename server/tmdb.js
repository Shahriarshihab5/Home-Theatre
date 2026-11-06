/**
 * Optional TMDB enrichment. Only used when TMDB_API_KEY is configured.
 * Adds better posters / ratings for titles already verified in CircleFTP.
 * Never used to claim availability — availability always comes from CircleFTP.
 */

const API_KEY = () => process.env.TMDB_API_KEY || ''
const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p/w500'

const cache = new Map()
const TTL = 24 * 60 * 60 * 1000

export const tmdbConfigured = () => Boolean(API_KEY())

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function enrich(title, year) {
  if (!API_KEY()) return { enabled: false }
  const q = String(title || '').trim()
  if (!q) return { enabled: true, match: null }

  const key = `${q}|${year || ''}`.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return { enabled: true, ...hit.data }

  const params = new URLSearchParams({ api_key: API_KEY(), query: q, include_adult: 'false' })
  if (year) params.set('year', String(year))

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(`${BASE}/search/movie?${params}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`TMDB ${res.status}`)
    const data = await res.json()
    const results = Array.isArray(data.results) ? data.results : []

    // Conservative matching: title similarity + year proximity.
    const target = normalize(q)
    let best = null
    let bestScore = 0
    for (const r of results.slice(0, 6)) {
      const rt = normalize(r.title)
      const ot = normalize(r.original_title)
      let score = 0
      if (rt === target || ot === target) score += 6
      else if (rt.includes(target) || target.includes(rt)) score += 3
      const ry = Number((r.release_date || '').slice(0, 4))
      if (year && ry) score += Math.max(0, 3 - Math.abs(ry - Number(year)) / 2)
      score += Math.min(2, (r.vote_average || 0) / 5)
      if (score > bestScore) {
        bestScore = score
        best = r
      }
    }

    const match =
      best && bestScore >= 4
        ? {
            tmdbId: best.id,
            title: best.title,
            year: Number((best.release_date || '').slice(0, 4)) || null,
            poster: best.poster_path ? `${IMG}${best.poster_path}` : '',
            backdrop: best.backdrop_path ? `https://image.tmdb.org/t/p/w1280${best.backdrop_path}` : '',
            rating: best.vote_average ? Number(best.vote_average.toFixed(1)) : null,
            overview: best.overview || '',
            genres: [], // genre_ids need a lookup; the app uses CircleFTP genres instead.
          }
        : null

    const payload = { match, at: Date.now() }
    cache.set(key, { at: Date.now(), data: payload })
    return { enabled: true, ...payload }
  } catch {
    return { enabled: true, match: null, error: 'TMDB lookup failed' }
  } finally {
    clearTimeout(timer)
  }
}
