/**
 * Tiny synthesised sound effects for the TV interface.
 *
 * No audio files are downloaded: everything is generated with the Web Audio
 * API, so it stays instant and works offline. The first key/pointer gesture
 * unlocks audio (TV browsers block sound until the viewer interacts).
 */

export type SoundName = 'focus' | 'select' | 'open' | 'like' | 'save' | 'success' | 'error'

const STORAGE_KEY = 'hmt:sfx'

let audio: AudioContext | null = null
let master: GainNode | null = null
let enabled = readEnabled()
const listeners = new Set<(on: boolean) => void>()

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audio) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audio = new Ctor()
    master = audio.createGain()
    master.gain.value = 0.12
    master.connect(audio.destination)
  }
  if (audio.state === 'suspended') void audio.resume()
  return audio
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine',
) {
  if (!master) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

function glide(
  ctx: AudioContext,
  from: number,
  to: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine',
) {
  if (!master) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, startAt)
  osc.frequency.exponentialRampToValueAtTime(to, startAt + duration)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/** Play one of the UI sounds. Safe to call anywhere; fails silently. */
export function playSound(name: SoundName) {
  if (!enabled) return
  const ctx = ensureContext()
  if (!ctx) return
  const t = ctx.currentTime

  switch (name) {
    case 'focus':
      tone(ctx, 740, t, 0.055, 0.16)
      break
    case 'select':
      tone(ctx, 520, t, 0.06, 0.18, 'triangle')
      tone(ctx, 780, t + 0.05, 0.08, 0.14, 'triangle')
      break
    case 'open':
      tone(ctx, 430, t, 0.08, 0.16, 'triangle')
      tone(ctx, 645, t + 0.07, 0.09, 0.15, 'triangle')
      tone(ctx, 860, t + 0.14, 0.11, 0.12, 'triangle')
      break
    case 'like':
      glide(ctx, 700, 1180, t, 0.16, 0.2, 'sine')
      break
    case 'save':
      tone(ctx, 560, t, 0.08, 0.16, 'triangle')
      tone(ctx, 840, t + 0.07, 0.12, 0.14, 'triangle')
      break
    case 'success': {
      // A soft four-note "found it!" arpeggio.
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((freq, i) => tone(ctx, freq, t + i * 0.085, 0.2, 0.16, 'triangle'))
      tone(ctx, 1567.98, t + 0.36, 0.28, 0.08, 'sine')
      break
    }
    case 'error':
      glide(ctx, 340, 210, t, 0.22, 0.18, 'sine')
      break
  }
}

export function getSfxEnabled() {
  return enabled
}

export function setSfxEnabled(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Ignore private-mode storage failures.
  }
  if (on) {
    ensureContext()
    playSound('select')
  }
  listeners.forEach((fn) => fn(on))
}

export function subscribeSfx(fn: (on: boolean) => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Global feedback: a tick when D-pad focus moves, a pop on select, and an
 * unlock on the first real interaction.
 */
export function installSfx() {
  const unlock = () => ensureContext()

  const onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.matches?.('[data-nav]')) playSound('focus')
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('[data-nav]')) playSound('select')
  }

  window.addEventListener('keydown', unlock, { passive: true })
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('focusin', onFocus)
  window.addEventListener('click', onClick, true)

  return () => {
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('focusin', onFocus)
    window.removeEventListener('click', onClick, true)
  }
}
