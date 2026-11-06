/**
 * Bundle small posters so the cloud copy (Vercel) looks right on a TV.
 *
 * CircleFTP serves posters over HTTP only, which an HTTPS page cannot load.
 * This script downloads the posters referenced by the learned catalog and
 * stores 150px-wide JPEGs in public/posters/, which ship with the site and are
 * served over HTTPS by Vercel.
 *
 * Run after a crawl:   npm run posters
 * Safe to re-run: existing posters are skipped.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const INDEX = path.join(ROOT, 'data', 'catalog-index.json')
const OUT_DIR = path.join(ROOT, 'public', 'posters')
const TMP_DIR = path.join(OUT_DIR, '_tmp')

const CONCURRENCY = 6
const WIDTH = 150
const QUALITY = 6

const ffmpeg = require('ffmpeg-static')

function readEntries() {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
    return Array.isArray(data?.entries) ? data.entries : []
  } catch {
    return []
  }
}

const jobs = []
const seen = new Set()
for (const entry of readEntries()) {
  const match = String(entry.thumb || '').match(/\/uploads\/video_thumb\/(\d+)\.jpg/i)
  if (!match) continue
  const id = match[1]
  if (seen.has(id)) continue
  seen.add(id)
  jobs.push({ id, url: entry.thumb })
}

if (!jobs.length) {
  console.error('No posters found — run the app on the home network first.')
  process.exit(1)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(TMP_DIR, { recursive: true })

const encode = (src, dest) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${WIDTH}:-2`, '-q:v', String(QUALITY), dest],
      { windowsHide: true },
    )
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
  })

let done = 0
let skipped = 0
let failed = 0
const started = Date.now()

async function worker(queue) {
  for (;;) {
    const job = queue.shift()
    if (!job) return
    const dest = path.join(OUT_DIR, `${job.id}.jpg`)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped += 1
      done += 1
      continue
    }
    const tmp = path.join(TMP_DIR, `${job.id}.src.jpg`)
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(45000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
      await encode(tmp, dest)
    } catch {
      failed += 1
      try {
        fs.unlinkSync(dest)
      } catch {
        /* not created */
      }
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* already gone */
      }
    }
    done += 1
    if (done % 100 === 0) {
      console.log(`posters: ${done}/${jobs.length} (${skipped} kept, ${failed} failed)`)
    }
  }
}

const queue = [...jobs]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
fs.rmSync(TMP_DIR, { recursive: true, force: true })

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg'))
const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0)
console.log(
  `posters: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${failed} failed, ${Math.round(
    (Date.now() - started) / 1000,
  )}s`,
)
