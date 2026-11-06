/**
 * Build a committed catalog snapshot for cloud hosting.
 *
 * CircleFTP only answers requests from its own network, so a deployment on
 * Vercel can never load the catalog live. This script turns the locally learned
 * quality index (data/catalog-index.json) into a slim snapshot that ships with
 * the repo, so the cloud site can still browse titles, search, and let the AI
 * recommend real catalog entries with real IMDb ratings.
 *
 * Run after a crawl:   npm run snapshot
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'data', 'catalog-index.json')
const TARGET_DIR = path.join(ROOT, 'server', 'data')
const TARGET = path.join(TARGET_DIR, 'catalog-snapshot.json')

function readEntries() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

const entries = readEntries()
  .filter((entry) => entry && entry.slug && entry.title)
  .map((entry) => ({
    slug: String(entry.slug),
    title: String(entry.title),
    year: entry.year ?? null,
    imdb: typeof entry.imdb === 'number' ? entry.imdb : null,
    genres: Array.isArray(entry.genres) ? entry.genres.slice(0, 6) : [],
    country: entry.country || '',
    audio: entry.audio || '',
    hindi: Boolean(entry.hindi),
    thumb: entry.thumb || '',
    quality: entry.quality || '',
    series: Boolean(entry.series),
  }))
  .sort((a, b) => (b.imdb ?? 0) - (a.imdb ?? 0))

if (!entries.length) {
  console.error('No entries found in data/catalog-index.json — run the app on the home network first.')
  process.exit(1)
}

fs.mkdirSync(TARGET_DIR, { recursive: true })
fs.writeFileSync(
  TARGET,
  JSON.stringify({ v: 1, generatedAt: Date.now(), count: entries.length, entries }),
)

const rated = entries.filter((e) => typeof e.imdb === 'number')
console.log(
  `snapshot: ${entries.length} titles (${rated.length} rated, avg ${
    rated.length ? (rated.reduce((s, e) => s + e.imdb, 0) / rated.length).toFixed(1) : '—'
  }) -> ${path.relative(ROOT, TARGET)}`,
)
console.log(`size: ${(fs.statSync(TARGET).size / 1024).toFixed(0)} kB`)
