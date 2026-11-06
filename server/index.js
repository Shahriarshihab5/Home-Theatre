import 'dotenv/config'
import os from 'node:os'
import app from './app.js'
import { indexStats, startCrawl, startWarmup } from './catalog.js'
import { aiMeta } from './ai.js'
import { transcodeAvailable } from './player.js'

const PORT = Number(process.env.PORT) || 8787

function lanAddresses() {
  const nets = os.networkInterfaces()
  const out = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address)
    }
  }
  return out
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('  🎬  Home Movie Theatre')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  Local:   http://localhost:${PORT}`)
  for (const ip of lanAddresses()) {
    console.log(`  TV:      http://${ip}:${PORT}   ← open this on your TV browser`)
  }
  console.log('')
  const ai = aiMeta()
  const aiLabel =
    ai.provider === 'gemini'
      ? `Gemini (${ai.model})`
      : ai.provider === 'deepseek'
        ? `DeepSeek (${ai.model})`
        : 'local ranking — add a free GEMINI_API_KEY to .env'
  console.log(`  AI:      ${aiLabel}`)
  console.log(`  TMDB:    ${process.env.TMDB_API_KEY ? 'enabled (optional metadata)' : 'disabled (using CircleFTP posters)'}`)
  console.log(`  Player:  ${transcodeAvailable() ? 'ffmpeg ready — AAC audio + track switching' : 'original streams only (ffmpeg not installed)'}`)
  console.log(`  Index:   ${indexStats().titles} titles already learned`)
  console.log('  ─────────────────────────────────────────────')
  console.log('')

  // Warm detail caches in the background so IMDb Top Rated / Hindi rows fill in.
  startWarmup()
    .then((n) => n && console.log(`[warmup] scanning details for ${n} catalog titles in background…`))
    .catch((err) => console.warn('[warmup] skipped:', err.message))

  // Long, gentle crawl that teaches the app real IMDb ratings across the
  // catalog. Results persist to data/catalog-index.json between restarts.
  setTimeout(() => {
    startCrawl()
      .then((n) => n && console.log(`[index] learned ratings for ${n} more titles`))
      .catch((err) => console.warn('[index] crawl skipped:', err.message))
  }, 3000)
})
