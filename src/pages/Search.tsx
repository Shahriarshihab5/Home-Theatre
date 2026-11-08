import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailModal } from '../components/DetailModal'
import { PosterCard } from '../components/PosterCard'
import { MicIcon, MicOffIcon, SearchIcon, SparkIcon } from '../components/icons'
import { api, prettyTitle } from '../lib/api'
import { useMemory } from '../lib/memory'
import { useVoiceRecognition } from '../lib/speech'
import type { CatalogItem, Detail } from '../types'

const SUGGESTIONS = [
  'Dangal',
  'Amir Khan',
  'Korean thriller',
  'Hindi comedy',
  'Shah Rukh Khan',
  'Top rated 2024',
]

type PersonInfo = NonNullable<Awaited<ReturnType<typeof api.search>>['person']>

export function SearchPage() {
  const memory = useMemory()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [person, setPerson] = useState<PersonInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  const run = useCallback(async (value: string) => {
    const q = value.trim()
    if (!q || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setQuery(q)
    setPerson(null)
    try {
      const result = await api.search(q)
      setItems(result.items)
      setPerson(result.person || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setItems([])
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const voice = useVoiceRecognition({
    lang: memory.prefs.listenLang === 'bn' ? 'bn-BD' : 'en-IN',
    onFinal: (transcript) => {
      setText(transcript)
      void run(transcript)
    },
  })

  const onFindSimilar = (detail: Detail) => navigate(`/?similar=${detail.slug}`)

  return (
    <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 md:px-8">
      <h1 className="text-2xl font-black tracking-tight md:text-3xl">Search the catalog</h1>
      <p className="mt-1 text-sm text-white/45">
        Search by title, actor, genre or country — “Dangal”, “Amir Khan sports movies”, “Korean thriller”.
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 p-2 focus-within:border-gold/50">
        <span className="pl-3 text-white/35">
          <SearchIcon width={20} height={20} />
        </span>
        <input
          ref={inputRef}
          data-nav
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run(text)
            if (e.key === 'Escape') inputRef.current?.blur()
          }}
          placeholder="Search by title, actor, genre or country…"
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
            title={voice.listening ? 'Stop listening' : 'Speak your search'}
            aria-label="Voice search"
          >
            {voice.listening ? <MicOffIcon width={18} height={18} /> : <MicIcon width={18} height={18} />}
            <span className="hidden sm:inline">{voice.listening ? 'Listening' : 'Voice'}</span>
          </button>
        ) : null}

        <button
          type="button"
          data-nav
          disabled={busy || !text.trim()}
          onClick={() => void run(text)}
          className="btn-primary shrink-0 !px-6"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      <div className="mt-2 min-h-[1.25rem] px-1 text-xs">
        {voice.listening ? (
          <p className="text-brand-soft">
            Listening… {voice.interim ? <span className="text-white/60">“{voice.interim}”</span> : 'say the title'}
          </p>
        ) : voice.error ? (
          <p className="text-amber-300/90">{voice.error}</p>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            data-nav
            onClick={() => {
              setText(s)
              void run(s)
            }}
            className="chip"
          >
            {s}
          </button>
        ))}
      </div>

      {error ? <p className="mt-5 text-sm text-amber-300">{error}</p> : null}

      {items ? (
        items.length ? (
          <>
            <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-white/35">
              {person ? (
                <>
                  {person.name} · {items.length} title{items.length === 1 ? '' : 's'}
                  {person.genres.length || person.countries.length || person.languages.length
                    ? ` · ${[...person.genres, ...person.countries, ...person.languages].join(', ')}`
                    : ''}
                </>
              ) : (
                <>
                  {items.length} title{items.length === 1 ? '' : 's'} for “{prettyTitle(query)}”
                </>
              )}
            </p>
            {person ? (
              <p className="mt-1 text-xs text-white/40">
                {person.description
                  ? `${person.description.charAt(0).toUpperCase()}${person.description.slice(1)}. `
                  : ''}
                Verified credits in this catalog.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3">
              {items.map((item) => (
                <PosterCard key={item.slug} item={item} onSelect={setSelected} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm font-semibold text-white/80">
              {person
                ? `No ${person.name} titles match ${
                    [...person.genres, ...person.countries, ...person.languages].join(', ') || 'that request'
                  } in the catalog.`
                : `No title matched “${query}”.`}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {person
                ? 'Try removing the genre or country, or let the AI suggest something close.'
                : 'Try fewer words. If it is a description (“Amir Khan sports movies”), let the AI find it.'}
            </p>
            <button
              type="button"
              data-nav
              onClick={() => navigate(`/?ask=${encodeURIComponent(query)}`)}
              className="btn-primary mt-4 !py-2 text-sm"
            >
              <SparkIcon width={16} height={16} /> Ask the AI instead
            </button>
          </div>
        )
      ) : null}

      <DetailModal item={selected} onClose={() => setSelected(null)} onFindSimilar={onFindSimilar} />
    </main>
  )
}
