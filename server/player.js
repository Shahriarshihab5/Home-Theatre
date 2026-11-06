/**
 * Browser-friendly playback.
 *
 * CircleFTP stores many titles as MKV with AC-3 / E-AC3 / DTS audio, which
 * Chrome-based browsers cannot decode — the picture plays and the sound is
 * silent. ffmpeg (ffmpeg-static, no system install needed) lets us:
 *
 *   • report the real audio tracks with their language tags (hin, kor, …)
 *   • stream a remuxed fMP4 where the video is copied untouched and the chosen
 *     audio track is converted to AAC, which every browser can decode
 *
 * That gives working sound AND real audio-track switching (via ?a=<track>).
 * Video is never re-encoded, so the CPU cost stays low.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let binCache

export function ffmpegBin() {
  if (binCache !== undefined) return binCache
  if (process.env.VERCEL || process.env.PLAYER_TRANSCODE === '0') {
    binCache = ''
    return binCache
  }
  try {
    const resolved = require('ffmpeg-static')
    binCache = typeof resolved === 'string' ? resolved : ''
  } catch {
    binCache = ''
  }
  return binCache
}

export const transcodeAvailable = () => Boolean(ffmpegBin())

const LANGUAGE_NAMES = {
  hin: 'Hindi',
  kor: 'Korean',
  eng: 'English',
  tam: 'Tamil',
  tel: 'Telugu',
  mal: 'Malayalam',
  kan: 'Kannada',
  ben: 'Bengali',
  mar: 'Marathi',
  pan: 'Punjabi',
  urd: 'Urdu',
  guj: 'Gujarati',
  jpn: 'Japanese',
  chi: 'Chinese',
  zho: 'Chinese',
  tha: 'Thai',
  tur: 'Turkish',
  fre: 'French',
  fra: 'French',
  spa: 'Spanish',
  ger: 'German',
  deu: 'German',
  rus: 'Russian',
  ara: 'Arabic',
  ita: 'Italian',
  por: 'Portuguese',
  ned: 'Dutch',
  swe: 'Swedish',
  dan: 'Danish',
  nor: 'Norwegian',
  pol: 'Polish',
  ind: 'Indonesian',
  vie: 'Vietnamese',
  fil: 'Filipino',
  und: 'Unlabelled',
}

const CODEC_LABELS = {
  aac: 'AAC',
  ac3: 'Dolby Digital (AC-3)',
  eac3: 'Dolby Digital Plus (E-AC3)',
  dts: 'DTS',
  truehd: 'Dolby TrueHD',
  mlp: 'Dolby TrueHD',
  opus: 'Opus',
  vorbis: 'Vorbis',
  mp3: 'MP3',
  flac: 'FLAC',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
}

/** Codecs a Chrome-based browser can decode without help. */
const BROWSER_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])

export function languageName(code) {
  if (!code) return ''
  return LANGUAGE_NAMES[String(code).toLowerCase()] || String(code).toUpperCase()
}

export function codecLabel(codec) {
  if (!codec) return 'Unknown'
  return CODEC_LABELS[String(codec).toLowerCase()] || String(codec).toUpperCase()
}

const probeCache = new Map()
const PROBE_TTL = 6 * 60 * 60 * 1000

function parseDuration(text) {
  const m = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function parseProbe(stderr) {
  const durationSec = parseDuration(stderr)
  const video = []
  const audio = []
  const subtitles = []

  for (const line of String(stderr).split(/\r?\n/)) {
    const m = line.match(/Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([\w-]+)\))?:\s*(Video|Audio|Subtitle):\s*([^]*)/)
    if (!m) continue
    const [, index, lang, kind, rest] = m
    const codec = rest.split(',')[0].trim().split(/\s+/)[0].toLowerCase()
    if (kind === 'Video') {
      const size = rest.match(/(\d{2,5})x(\d{2,5})/)
      video.push({
        streamIndex: Number(index),
        codec,
        width: size ? Number(size[1]) : null,
        height: size ? Number(size[2]) : null,
        browserSafe: codec === 'h264',
      })
    } else if (kind === 'Audio') {
      const channels = rest.match(/(mono|stereo|5\.1|6\.1|7\.1|(\d+) channels)/i)
      audio.push({
        ordinal: audio.length,
        streamIndex: Number(index),
        lang: lang || '',
        language: languageName(lang) || '',
        codec,
        codecLabel: codecLabel(codec),
        channels: channels ? channels[1] : '',
        browserSafe: BROWSER_SAFE_AUDIO.has(codec),
        isDefault: /\(default\)/.test(rest),
      })
    } else {
      subtitles.push({ streamIndex: Number(index), lang: lang || '', language: languageName(lang) || '', codec })
    }
  }

  const main = video[0] || null

  return {
    durationSec,
    video: main,
    audio,
    subtitles,
    // Can the browser play this file as-is (no remux)?
    directPlayable: Boolean(main?.browserSafe) && audio.every((a) => a.browserSafe),
    audioNeedsRemux: audio.some((a) => !a.browserSafe),
  }
}

/** Inspect a remote file with ffmpeg. Returns null when ffmpeg is unavailable. */
export function probeStream(url, { timeoutMs = 25000 } = {}) {
  const bin = ffmpegBin()
  if (!bin || !url) return Promise.resolve(null)

  const cached = probeCache.get(url)
  if (cached && Date.now() - cached.at < PROBE_TTL) return Promise.resolve(cached.data)

  return new Promise((resolve) => {
    let stderr = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (value) probeCache.set(url, { at: Date.now(), data: value })
      resolve(value)
    }

    const child = spawn(bin, ['-hide_banner', '-i', url], { windowsHide: true })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 120000) child.kill('SIGKILL')
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      const parsed = parseProbe(stderr)
      finish(parsed.video || parsed.audio.length ? parsed : null)
    })
  })
}

/**
 * ffmpeg arguments that produce a fragmented MP4 the browser can stream:
 * video copied as-is, one audio track converted to AAC.
 */
export function streamArgs({ url, audioOrdinal = 0, startSec = 0 }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
  if (startSec > 0.5) args.push('-ss', String(Math.floor(startSec)))
  args.push(
    '-i', url,
    '-map', '0:v:0',
    '-map', `0:a:${Math.max(0, audioOrdinal)}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  )
  return args
}

/** Start a streaming ffmpeg process. Caller pipes stdout to the HTTP response. */
export function startStream(options) {
  const bin = ffmpegBin()
  if (!bin) throw Object.assign(new Error('Audio remuxing is not available on this server'), { status: 503 })
  const child = spawn(bin, streamArgs(options), { windowsHide: true })
  return child
}
