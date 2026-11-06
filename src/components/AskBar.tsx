import { useRef, useState } from 'react'
import { KeyboardIcon, MicIcon, MicOffIcon, SearchIcon, SparkIcon, WandIcon } from './icons'
import { useVoiceRecognition } from '../lib/speech'

type Mode = 'ask' | 'search'

interface AskBarProps {
  busy?: boolean
  mode: Mode
  onModeChange: (mode: Mode) => void
  onSubmit: (text: string, mode: Mode) => void
  chips?: { label: string; prompt: string }[]
}

export function AskBar({ busy, mode, onModeChange, onSubmit, chips = [] }: AskBarProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (value?: string) => {
    const finalText = (value ?? text).trim()
    if (!finalText || busy) return
    onSubmit(finalText, mode)
    setText('')
  }

  const voice = useVoiceRecognition({
    lang: 'en-IN',
    onFinal: (transcript) => {
      setText(transcript)
      submit(transcript)
    },
  })

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-panel p-4 shadow-xl shadow-black/30 md:p-6">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-brand/15" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-gold/10" />

      <div className="relative">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-white/45">
            <WandIcon width={18} height={18} className="text-gold" />
            Ask Home Movie Theatre
          </div>

          <div className="flex rounded-full border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              data-nav
              onClick={() => onModeChange('ask')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                mode === 'ask' ? 'bg-brand text-white shadow' : 'text-white/50 hover:text-white'
              }`}
            >
              <SparkIcon width={14} height={14} /> AI picks
            </button>
            <button
              type="button"
              data-nav
              onClick={() => onModeChange('search')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                mode === 'search' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              <SearchIcon width={14} height={14} /> Search catalog
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 p-2 focus-within:border-gold/50">
          <span className="pl-3 text-white/35">
            {mode === 'ask' ? <SparkIcon width={20} height={20} className="text-gold" /> : <SearchIcon width={20} height={20} />}
          </span>
          <input
            id="ask-input"
            ref={inputRef}
            data-nav
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') inputRef.current?.blur()
            }}
            placeholder={
              mode === 'ask'
                ? '“Something for Olive”, “Korean thriller in Hindi”, “like my history”…'
                : 'Search titles in the CircleFTP catalog…'
            }
            className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-white placeholder:text-white/25 sm:text-lg"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
          />

          {voice.supported ? (
            <button
              type="button"
              data-nav
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                voice.listening
                  ? 'animate-pulseSoft bg-brand text-white'
                  : 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'
              }`}
              title={voice.listening ? 'Stop listening' : 'Speak your request'}
              aria-label="Voice input"
            >
              {voice.listening ? <MicOffIcon width={18} height={18} /> : <MicIcon width={18} height={18} />}
              <span className="hidden sm:inline">{voice.listening ? 'Listening' : 'Voice'}</span>
            </button>
          ) : null}

          <button type="button" data-nav disabled={busy} onClick={() => submit()} className="btn-primary shrink-0 !px-6">
            {busy ? 'Thinking…' : mode === 'ask' ? 'Ask' : 'Search'}
          </button>
        </div>

        <div className="mt-2 min-h-[1.25rem] px-1 text-xs">
          {voice.listening ? (
            <p className="text-brand-soft">
              Listening… {voice.interim ? <span className="text-white/60">“{voice.interim}”</span> : 'say what you want to watch'}
            </p>
          ) : voice.error ? (
            <p className="text-amber-300/90">{voice.error}</p>
          ) : !voice.supported ? (
            <p className="text-white/35">
              Voice isn’t available in this browser. Select the box and use your TV remote’s keyboard.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-white/30">
              <KeyboardIcon width={13} height={13} />
              Press <b className="text-white/55">Voice</b> to speak, or select the box and type with your TV remote.
            </p>
          )}
        </div>

        {chips.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                data-nav
                onClick={() => submit(chip.prompt)}
                className="chip"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
