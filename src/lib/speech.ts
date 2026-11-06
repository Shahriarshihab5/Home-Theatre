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

export function speak(text: string) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  } catch {
    /* TV browsers may not expose speech output — harmless */
  }
}

export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}
