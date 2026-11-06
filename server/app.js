import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  catalogMeta,
  cachedDetails,
  enrichItem,
  forYou,
  getDetail,
  getHindiSections,
  getHome,
  getListing,
  indexStats,
  searchCatalog,
  startCrawl,
  startWarmup,
} from './catalog.js'
import { aiMeta, aiConfigured, recommend, similarTo } from './ai.js'
import { probeStream, startStream, transcodeAvailable } from './player.js'
import { enrich, tmdbConfigured } from './tmdb.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const startedAt = Date.now()

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '300kb' }))

/* ─────────────────────────── simple rate limit ────────────────────────── */

const buckets = new Map()
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'local'
    const key = `${ip}:${req.path}`
    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests — please wait a moment.' })
    }
    next()
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/* ──────────────────────────────── routes ──────────────────────────────── */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    catalog: catalogMeta,
    ai: aiMeta(),
    tmdb: { configured: tmdbConfigured() },
    index: indexStats(),
    player: { transcode: transcodeAvailable() },
    mode: process.env.VERCEL ? 'vercel' : 'local',
  })
})

app.get(
  '/api/home',
  wrap(async (req, res) => {
    // Serverless instances start cold: kick a background scan so Top Rated / Hindi rows fill in.
    if (cachedDetails().length === 0) startWarmup().catch(() => {})
    const [home, hindi] = await Promise.all([getHome(), getHindiSections()])
    res.set('Cache-Control', 'no-store')
    res.json({
      ...home,
      // Re-enrich against the detail cache on every request so rows gain
      // genres/audio/ratings as the background scan progresses.
      latest: (home.latest || []).map(enrichItem),
      korean: (home.korean || []).map(enrichItem),
      family: (home.family || []).map(enrichItem),
      hindiMovies: hindi.movies.slice(0, 24),
      hindiSeries: hindi.series.slice(0, 24),
      hindiConfirmed: [...hindi.movies, ...hindi.series].slice(0, 18),
    })
  }),
)

app.get(
  '/api/hindi',
  wrap(async (req, res) => {
    const data = await getHindiSections()
    res.set('Cache-Control', 'no-store')
    res.json(data)
  }),
)

app.post(
  '/api/for-you',
  wrap(async (req, res) => {
    const { taste, exclude } = req.body || {}
    const result = await forYou(taste || {}, {
      exclude: Array.isArray(exclude) ? exclude.slice(0, 400).map(String) : [],
    })
    res.set('Cache-Control', 'no-store')
    res.json(result)
  }),
)

app.get(
  '/api/list',
  wrap(async (req, res) => {
    const type = String(req.query.type || 'genre')
    const slug = String(req.query.slug || '')
    const offset = Number(req.query.offset || 0)
    if (!slug) return res.status(400).json({ error: 'slug is required' })
    const data = await getListing(type, slug, offset)
    res.set('Cache-Control', 'public, max-age=300')
    res.json(data)
  }),
)

app.get(
  '/api/search',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').slice(0, 120)
    const data = await searchCatalog(q)
    res.set('Cache-Control', 'public, max-age=120')
    res.json(data)
  }),
)

app.get(
  '/api/detail',
  wrap(async (req, res) => {
    const slug = String(req.query.slug || '')
    if (!slug) return res.status(400).json({ error: 'slug is required' })
    const detail = await getDetail(slug)
    res.set('Cache-Control', 'public, max-age=600')
    res.json(detail)
  }),
)

app.get(
  '/api/similar',
  rateLimit(18, 10 * 60 * 1000),
  wrap(async (req, res) => {
    const slug = String(req.query.slug || '')
    if (!slug) return res.status(400).json({ error: 'slug is required' })
    const result = await similarTo(slug)
    res.json(result)
  }),
)

app.get(
  '/api/stream-info',
  wrap(async (req, res) => {
    const slug = String(req.query.slug || '')
    if (!slug) return res.status(400).json({ error: 'slug is required' })
    const detail = await getDetail(slug)
    const source = detail.sources?.[0]?.url || ''
    const info = source ? await probeStream(source) : null
    res.set('Cache-Control', 'public, max-age=1800')
    res.json({
      slug,
      source,
      transcode: transcodeAvailable(),
      info,
      filenameAudio: detail.audio || null,
      downloadUrl: detail.downloadUrl || '',
      watchUrl: detail.watchUrl,
    })
  }),
)

/**
 * Browser-friendly playback: video is copied, the chosen audio track is
 * converted to AAC. `a` = audio track ordinal, `t` = start position in seconds
 * (the player restarts the stream when the viewer seeks).
 */
app.get(
  '/api/play',
  wrap(async (req, res) => {
    const slug = String(req.query.slug || '')
    const audio = Math.max(0, Number(req.query.a || 0) || 0)
    const start = Math.max(0, Number(req.query.t || 0) || 0)
    if (!slug) return res.status(400).json({ error: 'slug is required' })
    if (!transcodeAvailable()) {
      return res.status(503).json({ error: 'Audio remuxing is not available on this server' })
    }

    const detail = await getDetail(slug)
    const source = detail.sources?.[0]?.url
    if (!source) return res.status(404).json({ error: 'No direct stream for this title' })

    const info = await probeStream(source).catch(() => null)
    const trackCount = info?.audio?.length || 1
    const ordinal = Math.min(audio, trackCount - 1)

    res.status(200)
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Accept-Ranges', 'none')

    const child = startStream({ url: source, audioOrdinal: ordinal, startSec: start })
    let failure = ''
    child.stderr.on('data', (chunk) => {
      if (failure.length < 600) failure += chunk.toString()
    })
    child.stdout.pipe(res)
    child.on('error', () => res.destroy())
    child.on('close', (code) => {
      if (code && failure) console.warn('[play] ffmpeg:', failure.trim().slice(0, 300))
      if (!res.writableEnded) res.destroy()
    })
    req.on('close', () => child.kill('SIGKILL'))
  }),
)

app.post(
  // `/api/recommend` is the one-segment alias: Vercel's catch-all function does
  // not route nested API paths like `/api/ai/recommend` on this deployment.
  ['/api/ai/recommend', '/api/recommend'],
  rateLimit(30, 10 * 60 * 1000),
  wrap(async (req, res) => {
    const { message, memory, prefs, referenceSlug, targetName, avoidSlugs, history, topic } = req.body || {}
    const result = await recommend({
      message,
      memory,
      prefs,
      referenceSlug,
      targetName,
      avoidSlugs,
      history,
      topic,
    })
    res.json(result)
  }),
)

app.get(
  '/api/tmdb',
  wrap(async (req, res) => {
    if (!tmdbConfigured()) return res.json({ enabled: false, match: null })
    const title = String(req.query.title || '')
    const year = Number(req.query.year) || undefined
    const result = await enrich(title, year)
    res.set('Cache-Control', 'public, max-age=3600')
    res.json(result)
  }),
)

/* ────────────────────────── poster image proxy ────────────────────────── */
/* Needed when the app is served over HTTPS (Vercel) because CircleFTP is HTTP-only. */

const ALLOWED_IMAGE_HOSTS = new Set(['hd.circleftp.net', 'image.tmdb.org', 'new.circleftp.net'])

app.get(
  '/api/image',
  wrap(async (req, res) => {
    const raw = String(req.query.url || '')
    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      return res.status(400).json({ error: 'Invalid image URL' })
    }
    if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
      return res.status(403).json({ error: 'Host not allowed' })
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const upstream = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'HomeMovieTheatre/1.0', Accept: 'image/*' },
    }).finally(() => clearTimeout(timer))

    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).end()
    }

    const type = upstream.headers.get('content-type') || 'image/jpeg'
    if (!type.startsWith('image/')) return res.status(415).end()

    res.set('Content-Type', type)
    res.set('Cache-Control', 'public, max-age=86400, immutable')
    try {
      Readable.fromWeb(upstream.body).pipe(res)
    } catch {
      res.status(502).end()
    }
  }),
)

/* ───────────────────────────── static app ─────────────────────────────── */

const hasDist = fs.existsSync(path.join(DIST, 'index.html'))
if (hasDist) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res
      .type('text/html')
      .send(
        `<body style="font-family:system-ui;background:#0a0a0f;color:#eee;padding:40px;line-height:1.6">
          <h1>Home Movie Theatre — server running</h1>
          <p>The UI has not been built yet. In development, open the Vite URL (default
          <b>http://localhost:5173</b>). For production run <code>npm run build</code> then <code>npm start</code>.</p>
          <p>API check: <a style="color:#f87171" href="/api/health">/api/health</a></p>
        </body>`,
      )
  })
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (/responded 404/i.test(err.message) ? 404 : 502)
  console.error('[api error]', err.message)
  res.status(status).json({
    error: err.message || 'Unexpected server error',
    hint: /CircleFTP|fetch|ENOTFOUND|ECONN/i.test(err.message)
      ? 'The server could not reach CircleFTP. Check internet access / CATALOG_BASE.'
      : undefined,
  })
})

export default app
