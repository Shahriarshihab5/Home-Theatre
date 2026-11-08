import { useCallback, useEffect, useRef, useState } from 'react'

/* ─────────────────────────────── voice input ─────────────────────────────── */

type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function speechSupported(): boolean {
  return Boolean(getRecognitionCtor())
}

interface UseVoiceOptions {
  lang?: string
  onFinal?: (text: string) => void
}

export function useVoiceRecognition({ lang = 'en-IN', onFinal }: UseVoiceOptions = {}) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const supported = speechSupported()

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    setError(null)
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('Voice input is not supported by this browser. Use the on-screen keyboard.')
      return
    }
    try {
      recognitionRef.current?.abort()
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 1
      rec.onresult = (event: any) => {
        let finalText = ''
        let partial = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) finalText += result[0].transcript
          else partial += result[0].transcript
        }
        setInterim(partial)
        if (finalText.trim()) {
          setInterim('')
          onFinal?.(finalText.trim())
        }
      }
      rec.onerror = (event: any) => {
        const code = event?.error || 'unknown'
        const messages: Record<string, string> = {
          'not-allowed': 'Microphone permission was denied. Enable it in the TV browser settings or use the keyboard.',
          'service-not-allowed': 'Speech service blocked. Use the on-screen keyboard instead.',
          'no-speech': "I didn't hear anything. Try again.",
          network: 'Speech recognition needs a network connection.',
          'language-not-supported':
            'This browser cannot understand Bangla speech. Switch “You speak” to English in Settings, or type the request.',
          'audio-capture': 'No microphone found. Use the keyboard instead.',
          aborted: '',
        }
        const message = messages[code] ?? `Voice error: ${code}. You can type instead.`
        if (message) setError(message)
        setListening(false)
      }
      rec.onend = () => setListening(false)
      recognitionRef.current = rec
      rec.start()
      setListening(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start microphone')
      setListening(false)
    }
  }, [lang, onFinal])

  useEffect(() => {
    return () => recognitionRef.current?.abort()
  }, [])

  return { supported, listening, error, interim, start, stop, setError }
}

/* ─────────────────────────────── speech output ───────────────────────────── */

export type VoiceLang = 'en' | 'bn'
export type VoiceGender = 'female' | 'male'

const VOICE_LANG_ORDER: Record<VoiceLang, string[]> = {
  en: ['en-in', 'en-gb', 'en-us', 'en-au', 'en'],
  bn: ['bn-bd', 'bn-in', 'bn'],
}

const FEMALE_HINTS = /female|woman|zira|heera|neerja|samantha|karen|tessa|victoria|susan|fiona|moira|aria|jenny|emma|ava|allison|serena|swara|kalpana/i
const MALE_HINTS = /\bmale\b|man\b|david|mark\b|ravi|rishi|daniel|alex\b|fred|george|james|ryan|guy\b|prabhat|hemant/i

/** Browsers load voices asynchronously; keep a warm cache for the TV UI. */
let cachedVoices: SpeechSynthesisVoice[] = []

export function primeVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const load = () => {
    const list = window.speechSynthesis.getVoices()
    if (list.length) cachedVoices = list
  }
  load()
  window.speechSynthesis.onvoiceschanged = load
}

/** Voices available on this device, for the settings screen. */
export function availableVoices(lang: VoiceLang) {
  const list = cachedVoices.length ? cachedVoices : window.speechSynthesis?.getVoices?.() || []
  return list.filter((v) => VOICE_LANG_ORDER[lang].some((tag) => v.lang?.toLowerCase().replace('_', '-').startsWith(tag)))
}

function scoreVoice(voice: SpeechSynthesisVoice, lang: VoiceLang, gender: VoiceGender) {
  const voiceLang = (voice.lang || '').toLowerCase().replace('_', '-')
  const rank = VOICE_LANG_ORDER[lang].findIndex((tag) => voiceLang === tag || voiceLang.startsWith(`${tag}-`))
  if (rank < 0) return -1
  let score = (VOICE_LANG_ORDER[lang].length - rank) * 10
  const name = `${voice.name} ${voice.voiceURI}`
  const female = FEMALE_HINTS.test(name)
  const male = MALE_HINTS.test(name)
  if (gender === 'female') {
    if (female) score += 6
    if (male && !female) score -= 4
  } else {
    if (male) score += 6
    if (female && !male) score -= 4
  }
  if (voice.localService) score += 1
  return score
}

export function pickVoice(lang: VoiceLang, gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const list = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices()
  if (list.length) cachedVoices = list
  let best: SpeechSynthesisVoice | null = null
  let bestScore = -1
  for (const voice of list) {
    const score = scoreVoice(voice, lang, gender)
    if (score > bestScore) {
      best = voice
      bestScore = score
    }
  }
  return bestScore >= 0 ? best : null
}

export interface SpeakOptions {
  lang?: VoiceLang
  gender?: VoiceGender
}

/* Server-side speech is used for Bengali because most TVs have no Bengali
 * voice installed. It returns a female Bengali MP3, so the assistant actually
 * talks on every device. English keeps the device's native voice. */
let currentAudio: HTMLAudioElement | null = null
let speakToken = 0

function stopAudio() {
  if (!currentAudio) return
  try {
    currentAudio.pause()
  } catch {
    /* ignore */
  }
  currentAudio.src = ''
  currentAudio = null
}

function speakNative(text: string, { lang, gender }: Required<SpeakOptions>) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    primeVoices()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(lang, gender)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = lang === 'bn' ? 'bn-BD' : 'en-IN'
    }
    utterance.rate = lang === 'bn' ? 0.92 : 1
    utterance.pitch = gender === 'female' ? 1.08 : 0.92
    window.speechSynthesis.speak(utterance)
  } catch {
    /* TV browsers may not expose speech output — harmless */
  }
}

async function speakFromServer(text: string, token: number, fallback: () => void) {
  try {
    const audio = new Audio(`/api/tts?lang=bn&text=${encodeURIComponent(text.slice(0, 900))}`)
    audio.preload = 'auto'
    currentAudio = audio
    audio.onerror = () => {
      if (token !== speakToken) return
      stopAudio()
      fallback()
    }
    await audio.play()
  } catch {
    if (token !== speakToken) return
    stopAudio()
    fallback()
  }
}

export function speak(text: string, { lang = 'en', gender = 'female' }: SpeakOptions = {}) {
  if (!text || typeof window === 'undefined') return
  const token = ++speakToken
  stopAudio()
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }

  if (lang === 'bn') {
    // Prefer the server voice (always female Bengali); fall back to the device.
    void speakFromServer(text, token, () => speakNative(text, { lang, gender }))
    return
  }
  speakNative(text, { lang, gender })
}

export function stopSpeaking() {
  speakToken += 1
  stopAudio()
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}
