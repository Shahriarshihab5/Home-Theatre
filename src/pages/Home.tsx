import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { aiProviderLabel, api, imgSrc, prettyTitle } from '../lib/api'
import { useMemory } from '../lib/memory'
import { detectProfile, GROUP_PROFILE, GROUP_PROFILE_ID, profileById } from '../lib/profiles'
import { playSound } from '../lib/sfx'
import { speak, stopSpeaking } from '../lib/speech'
import type { AiPick, AiResult, CatalogItem, Detail, HomeData } from '../types'
import { AskBar } from '../components/AskBar'
import { DetailModal } from '../components/DetailModal'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { HindiBadge, ImdbBadge, QualityBadge } from '../components/Badges'
import {
  BookmarkIcon,
  CheckIcon,
  HeartIcon,
  InfoIcon,
  OpenIcon,
  PlayIcon,
  SparkIcon,
  SpeakerIcon,
  ThumbDownIcon,
  WandIcon,
  XIcon,
} from '../components/icons'

const CHIPS = [
  { label: 'For Olive', prompt: 'Recommend something my brother Olive would like, based on his taste.' },
  { label: 'For Shahnaj', prompt: 'Recommend something my mother Shahnaj would like, based on her taste.' },
  { label: 'From my history', prompt: 'Recommend something based on my watch history and the titles I liked.' },
  { label: 'Hindi web series', prompt: 'Recommend a Hindi web series with Hindi audio.' },
  { label: 'Korean thriller', prompt: 'Recommend a Korean thriller with Hindi audio.' },
  { label: 'Family night', prompt: 'Find something family-friendly we can watch together.' },
  { label: 'Something new', prompt: "Show me something new I haven't watched yet." },
]

function PickCard({
  pick,
  onOpen,
  onSave,
  onRate,
  saved,
  rating,
}: {
  pick: AiPick
  onOpen: () => void
  onSave: () => void
  onRate: (value: 'like' | 'dislike') => void
  saved: boolean
  rating?: 'like' | 'dislike'
}) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:border-white/20">
      <button
        type="button"
        data-nav
        onClick={onOpen}
        className="h-[132px] w-[88px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-panel2"
        aria-label={`Details for ${pick.title}`}
      >
        {pick.thumb ? (
          <img src={imgSrc(pick.thumb)} alt={pick.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-white/20">🎬</div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <QualityBadge quality={pick.quality} />
          <HindiBadge audio={pick.audio} />
          <ImdbBadge rating={pick.imdbRating} />
        </div>
        <button
          type="button"
          data-nav
          onClick={onOpen}
          className="mt-1 block w-full truncate text-left text-[0.95rem] font-bold text-white/95 hover:text-white"
        >
          {prettyTitle(pick.title)}
        </button>
        <p className="mt-0.5 text-[0.7rem] text-white/35">
          {[pick.year, pick.duration, pick.country, pick.genres?.slice(0, 2).join(' · ')].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-white/60">{pick.why}</p>

        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" data-nav onClick={onOpen} className="btn-soft !px-3 !py-1.5 text-xs">
            <InfoIcon width={14} height={14} /> Details
          </button>
          <button
            type="button"
            data-nav
            onClick={onSave}
            className={`btn-soft !px-3 !py-1.5 text-xs ${saved ? '!border-gold/60 !text-gold' : ''}`}
            title="Add to wishlist"
          >
            <BookmarkIcon width={14} height={14} filled={saved} />
          </button>
          <button
            type="button"
            data-nav
            onClick={() => onRate('like')}
            className={`btn-soft !px-3 !py-1.5 text-xs ${rating === 'like' ? '!border-brand/70 !text-brand-soft' : ''}`}
            title="Like"
          >
            <HeartIcon width={14} height={14} filled={rating === 'like'} />
          </button>
          <button
            type="button"
            data-nav
            onClick={() => onRate('dislike')}
            className={`btn-soft !px-3 !py-1.5 text-xs ${rating === 'dislike' ? '!border-white/60 !text-white' : ''}`}
            title="Dislike"
          >
            <ThumbDownIcon width={14} height={14} filled={rating === 'dislike'} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function HomePage() {
  const memory = useMemory()
  const navigate = useNavigate()
  const location = useLocation()

  const [home, setHome] = useState<HomeData | null>(null)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [health, setHealth] = useState<{ ai: { configured: boolean; provider: string } } | null>(null)

  const [mode, setMode] = useState<'ask' | 'search'>('ask')
  const [ai, setAi] = useState<AiResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [targetName, setTargetName] = useState<string | null>(null)
  const [search, setSearch] = useState<{ query: string; items: CatalogItem[] } | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [forYou, setForYou] = useState<CatalogItem[]>([])
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const spokenRef = useRef<string>('')
  const ranSimilar = useRef('')
  const lastQueryRef = useRef('')
  const lastPicksRef = useRef<AiPick[]>([])

  const loadHome = useCallback(async () => {
    setHomeLoading(true)
    setHomeError(null)
    try {
      setHome(await api.home())
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Could not load the catalog')
    } finally {
      setHomeLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHome()
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [loadHome])

  // Personalised row, re-ranked whenever this profile's taste changes.
  useEffect(() => {
    if (!memory.ready) return
    let cancelled = false
    api
      .forYou({ taste: memory.taste })
      .then((res) => !cancelled && setForYou(res.items || []))
      .catch(() => !cancelled && setForYou([]))
    return () => {
      cancelled = true
    }
  }, [memory.ready, memory.profile, memory.taste])

  useEffect(() => () => stopSpeaking(), [])

  useEffect(() => {
    if (ai?.reply && memory.prefs.tts && spokenRef.current !== ai.reply) {
      spokenRef.current = ai.reply
      speak(ai.reply)
    }
  }, [ai, memory.prefs.tts])

  const ask = useCallback(
    async (text: string) => {
      setAiBusy(true)
      setAiError(null)
      setSearch(null)

      // If the request names a family member, answer using that person's memory.
      // "me"/"my taste" always mean the currently selected person, and every
      // request is labelled with whose taste is being used.
      const target = detectProfile(text, memory.profiles, memory.profile)
      const activeIsGroup = memory.profile === GROUP_PROFILE_ID
      const effectiveTarget = target ?? (activeIsGroup ? GROUP_PROFILE_ID : memory.profile)
      const snapshot =
        effectiveTarget && effectiveTarget !== memory.profile
          ? memory.snapshotFor(effectiveTarget)
          : null
      const name =
        effectiveTarget === GROUP_PROFILE_ID
          ? GROUP_PROFILE.name
          : profileById(effectiveTarget, memory.profiles).name
      setTargetName(name)

      // Refinements like "not this type" or "more like these" reuse the last
      // request and tell the server to avoid titles already on screen.
      const previousQuery = lastQueryRef.current
      const refineRe =
        /^(not (this|these|that)|something (else|different)|different (type|kind)|another (type|kind)|more like|show me more|more picks|try again|try something|no[, ]+(i|we)?\s*(need|want)|change (the )?(type|country|language|genre))/i
      const refining = Boolean(previousQuery) && refineRe.test(text.trim())
      let requestMessage = text
      let avoidSlugs: string[] = []

      if (refining) {
        const titles = lastPicksRef.current.map((p) => p.title).filter(Boolean).join('; ')
        const wantsMore = /more like|similar|same/i.test(text)
        requestMessage = wantsMore
          ? `Original request: ${previousQuery}. The viewer liked these picks: ${titles}. Recommend more titles in the same style, but different titles.`
          : `Original request: ${previousQuery}. The viewer said "${text}". Do not recommend any of these again: ${titles}. Suggest a clearly different type of title.`
        avoidSlugs = lastPicksRef.current.map((p) => p.slug)
      }

      try {
        const result = await api.recommend({
          message: requestMessage,
          memory: snapshot?.memory ?? memory.memorySummary(),
          prefs: snapshot?.prefs ?? memory.prefs,
          targetName: name,
          avoidSlugs,
        })
        setAi(result)
        lastQueryRef.current = refining ? previousQuery : text
        lastPicksRef.current = result.picks || []
        playSound('success')
        if (!memory.prefs.tts) stopSpeaking()
      } catch (err) {
        setAiError(err instanceof Error ? err.message : 'The AI request failed')
        setAi(null)
        playSound('error')
      } finally {
        setAiBusy(false)
      }
    },
    [memory],
  )

  // "Find similar" links arrive as /?similar=slug from other pages.
  useEffect(() => {
    const slug = new URLSearchParams(location.search).get('similar')
    if (!slug || ranSimilar.current === slug) return
    ranSimilar.current = slug
    navigate('/', { replace: true })
    setMode('ask')
    setAiBusy(true)
    setAiError(null)
    setSearch(null)
    api
      .similar(slug)
      .then(setAi)
      .catch((err) => setAiError(err instanceof Error ? err.message : 'Could not find similar titles'))
      .finally(() => setAiBusy(false))
  }, [location.search, navigate])

  const runSearch = useCallback(async (text: string) => {
    setSearchBusy(true)
    setSearchError(null)
    setAi(null)
    setTargetName(null)
    try {
      const result = await api.search(text)
      // A descriptive request ("korean village family thriller") is not a
      // literal title search. If it finds almost nothing, hand it to the AI
      // instead of showing an empty/irrelevant list.
      const descriptive =
        /\b(korean|japanese|chinese|tamil|telugu|turkish|thai|indian|hollywood|village|family|thriller|comedy|romantic|drama|horror|series|episode|like|similar|best|good)\b/i.test(
          text,
        )
      if (result.items.length < 4 && descriptive && text.trim().split(/\s+/).length > 1) {
        setSearch(null)
        setMode('ask')
        await ask(text)
        return
      }
      setSearch({ query: result.query, items: result.items })
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
      setSearch({ query: text, items: [] })
    } finally {
      setSearchBusy(false)
    }
  }, [ask])

  const submit = useCallback(
    (text: string, nextMode: 'ask' | 'search') => {
      setMode(nextMode)
      if (nextMode === 'ask') void ask(text)
      else void runSearch(text)
    },
    [ask, runSearch],
  )

  useEffect(() => {
    const onBack = () => {
      if (selected) return // handled by the modal itself
      if (ai || aiError || search) {
        setAi(null)
        setAiError(null)
        setSearch(null)
        setTargetName(null)
        stopSpeaking()
      }
    }
    document.addEventListener('tv-back', onBack)
    return () => document.removeEventListener('tv-back', onBack)
  }, [ai, aiError, search, selected])

  const rankByTaste = useCallback(
    (items: CatalogItem[]): CatalogItem[] => {
      const genres = memory.taste.genres
      const countries = memory.taste.countries
      if (!Object.keys(genres).length && !Object.keys(countries).length) return items
      const score = (item: CatalogItem) => {
        let value = 0
        for (const genre of item.genres || []) value += genres[genre] || 0
        if (item.country) value += (countries[item.country] || 0) * 0.8
        return value
      }
      return [...items].sort((a, b) => score(b) - score(a))
    },
    [memory.taste],
  )

  const rows = useMemo(() => {
    if (!home) {
      return {
        forYou: [] as CatalogItem[],
        topRated: [] as CatalogItem[],
        hindiMovies: [] as CatalogItem[],
        hindiSeries: [] as CatalogItem[],
        korean: [] as CatalogItem[],
        family: [] as CatalogItem[],
        latest: [] as CatalogItem[],
      }
    }
    return {
      forYou,
      topRated: rankByTaste(home.topRated || []),
      hindiMovies: rankByTaste(home.hindiMovies || []),
      hindiSeries: rankByTaste(home.hindiSeries || []),
      korean: rankByTaste(home.korean || []),
      family: rankByTaste(home.family || []),
      latest: rankByTaste(home.latest || []),
    }
  }, [home, forYou, rankByTaste])

  const pct = (item: CatalogItem) => {
    const entry = memory.history.find((h) => h.slug === item.slug)
    if (!entry || !entry.durationSec) return undefined
    return Math.min(1, entry.positionSec / entry.durationSec)
  }

  const showBrowse = !ai && !aiError && !search && !searchBusy
  const tasteSignals = memory.likes.length + memory.history.length

  return (
    <main className="mx-auto max-w-[1700px] px-4 md:px-8">
      <section className="pb-2 pt-5 md:pt-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="max-w-3xl text-2xl font-black leading-[1.1] tracking-tight md:text-4xl">
              What should we{' '}
              <span className="bg-gradient-to-r from-brand via-brand-soft to-gold bg-clip-text text-transparent">
                watch tonight?
              </span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-white/45">
              Picks for <b className="text-white/70">{memory.profileName}</b> — every suggestion is checked
              against the CircleFTP catalog before it’s shown.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-white/35">
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              <SparkIcon width={13} height={13} className="text-gold" />
              {tasteSignals > 0
                ? `Learning from ${memory.likes.length} likes · ${memory.history.length} watched`
                : 'Like or watch titles to teach your profile'}
            </span>
            {health ? (
              <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${health.ai.configured ? 'bg-emerald-400' : 'bg-amber-400'}`}
                />
                {health.ai.configured ? `${aiProviderLabel(health.ai.provider)} ready` : 'Local ranking'}
              </span>
            ) : null}
          </div>
        </div>

        <AskBar busy={aiBusy || searchBusy} mode={mode} onModeChange={setMode} onSubmit={submit} chips={CHIPS} />
      </section>

      {aiBusy ? (
        <section className="my-5 rounded-3xl border border-white/10 bg-panel p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 animate-pulseSoft items-center justify-center rounded-xl bg-brand/20 text-brand-soft">
              <WandIcon width={20} height={20} />
            </span>
            <div>
              <p className="text-sm font-bold text-white/80">
                Checking the catalog{targetName ? ` for ${targetName}` : ''}…
              </p>
              <p className="text-xs text-white/40">Matching the request against verified CircleFTP titles.</p>
            </div>
          </div>
        </section>
      ) : null}

      {ai && !aiBusy ? (
        <section className="my-5 animate-fadeUp rounded-3xl border border-white/10 bg-panel p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-gold/80 text-white">
                <WandIcon width={20} height={20} />
              </span>
              <div>
                <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                  Your AI concierge
                  {ai.targetName ? (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.58rem] tracking-wide text-gold">
                      For {ai.targetName}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.58rem] tracking-wide ${
                      ai.source === 'ai' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {ai.source === 'ai' ? ai.model || 'AI' : 'local ranking'}
                  </span>
                </p>
                <p className="mt-1 max-w-3xl text-[0.98rem] leading-relaxed text-white/85 md:text-[1.05rem]">{ai.reply}</p>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                data-nav
                onClick={() => speak(ai.reply)}
                className="btn-ghost !p-2"
                title="Read aloud"
                aria-label="Read reply aloud"
              >
                <SpeakerIcon width={18} height={18} />
              </button>
              <button
                type="button"
                data-nav
                onClick={() => {
                  setAi(null)
                  stopSpeaking()
                }}
                className="btn-ghost !p-2"
                title="Clear"
                aria-label="Clear AI result"
              >
                <XIcon width={18} height={18} />
              </button>
            </div>
          </div>

          {ai.picks.length ? (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {ai.picks.map((pick) => (
                <PickCard
                  key={pick.slug}
                  pick={pick}
                  onOpen={() => setSelected(pick)}
                  onSave={() => memory.toggleWatchlist(pick)}
                  onRate={(value) => memory.rate(pick, value)}
                  saved={memory.watchlist.some((w) => w.slug === pick.slug)}
                  rating={memory.ratings[pick.slug]?.value}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/40">
              No verified titles matched. Try a different genre or year.
            </p>
          )}

          {ai.picks.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="mb-2 text-[0.68rem] font-bold uppercase tracking-wider text-white/35">
                Not quite right? Refine it
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-nav
                  onClick={() => ask('Not this type — show something different')}
                  className="chip !text-xs"
                >
                  Not this type
                </button>
                <button
                  type="button"
                  data-nav
                  onClick={() => ask('More like these, but different titles')}
                  className="chip !text-xs"
                >
                  More like these
                </button>
                <button
                  type="button"
                  data-nav
                  onClick={() => ask('Change the language or country — show something different')}
                  className="chip !text-xs"
                >
                  Different language
                </button>
              </div>
              <p className="mt-2 text-[0.65rem] text-white/25">
                You can also say “no, I need this type” with Voice — the AI remembers your last
                request.
              </p>
            </div>
          ) : null}

          {ai.followups.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {ai.followups.map((followup) => (
                <button
                  key={followup}
                  type="button"
                  data-nav
                  onClick={() => submit(followup, 'ask')}
                  className="chip !text-xs"
                >
                  {followup}
                </button>
              ))}
            </div>
          ) : null}

          <p className="mt-4 flex items-center gap-1.5 text-[0.65rem] text-white/25">
            <CheckIcon width={12} height={12} />
            {ai.candidates ? `${ai.candidates} verified catalog titles considered · ` : ''}
            availability from CircleFTP · audio details are honest, not guesses
          </p>
        </section>
      ) : null}

      {aiError ? (
        <section className="my-5 animate-fadeUp rounded-3xl border border-brand/30 bg-brand/10 p-5">
          <p className="text-sm font-semibold text-brand-soft">The AI request didn’t complete</p>
          <p className="mt-1 text-sm text-white/60">{aiError}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" data-nav onClick={() => setAiError(null)} className="btn-soft !py-2 text-sm">
              Dismiss
            </button>
            <button
              type="button"
              data-nav
              onClick={() => submit('Surprise me with something great for tonight', 'ask')}
              className="btn-primary !py-2 text-sm"
            >
              Try a simple request
            </button>
          </div>
        </section>
      ) : null}

      {searchBusy ? (
        <section className="my-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer aspect-[2/3] rounded-2xl" />
          ))}
        </section>
      ) : null}

      {search && !searchBusy ? (
        <section className="my-5 animate-fadeUp">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                Results for <span className="text-brand-soft">“{search.query}”</span>
              </h2>
              <p className="text-xs text-white/35">
                {search.items.length} verified CircleFTP title{search.items.length === 1 ? '' : 's'}
              </p>
            </div>
            <button type="button" data-nav onClick={() => setSearch(null)} className="btn-ghost !py-2 text-sm">
              <XIcon width={16} height={16} /> Close
            </button>
          </div>

          {searchError ? <p className="mb-3 text-sm text-amber-300/80">{searchError}</p> : null}

          {search.items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {search.items.map((item) => (
                <PosterCard key={item.slug} item={item} onSelect={setSelected} widthClass="w-full" />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
              Nothing found in the catalog. Try another spelling, or ask the AI instead.
            </div>
          )}
        </section>
      ) : null}

      {showBrowse ? (
        <div className="space-y-6 pb-8 pt-4">
          {memory.continueWatching.length ? (
            <Row
              title="Continue Watching"
              items={memory.continueWatching}
              onSelect={setSelected}
              progressFor={pct}
              subtitleFor={(item) => {
                const h = memory.history.find((x) => x.slug === item.slug)
                return h ? `Resume at ${Math.floor(h.positionSec / 60)}m ${Math.floor(h.positionSec % 60)}s` : undefined
              }}
              accent="gold"
            />
          ) : null}

          {memory.watchlist.length ? (
            <Row title="Your Wishlist" items={memory.watchlist} onSelect={setSelected} accent="none" />
          ) : null}

          {homeLoading && !home ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="shimmer aspect-[2/3] rounded-2xl" />
              ))}
            </div>
          ) : null}

          {homeError && !home ? (
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-6">
              <p className="font-semibold text-amber-200">The catalog couldn’t be reached</p>
              <p className="mt-1 text-sm text-white/55">{homeError}</p>
              <p className="mt-2 text-xs text-white/35">
                The server fetches CircleFTP over HTTP. Make sure your PC has internet access, then retry.
              </p>
              <button type="button" data-nav onClick={() => void loadHome()} className="btn-soft mt-4 !py-2 text-sm">
                Retry
              </button>
            </div>
          ) : null}

          <Row
            title={`Picked for ${memory.profileName}`}
            items={rows.forYou}
            note="Ranked from this profile's likes, history and preferences."
            onSelect={setSelected}
            accent="gold"
          />

          {rows.topRated.length ? (
            <Row
              title="IMDb Top Rated — available now"
              items={rows.topRated}
              note={home?.topRatedNote}
              onSelect={setSelected}
              accent="gold"
            />
          ) : null}

          <Row
            title="Hindi Movies"
            items={rows.hindiMovies}
            note="Hindi audio confirmed from the stream filename."
            onSelect={setSelected}
          />

          <Row
            title="Hindi Web Series"
            items={rows.hindiSeries}
            note="Hindi audio confirmed from the stream filename."
            onSelect={setSelected}
          />

          <Row title="Korean Titles" items={rows.korean} note={home?.koreanNote} onSelect={setSelected} accent="none" />
          <Row title="Family Night" items={rows.family} onSelect={setSelected} />
          <Row title="Recently Added" items={rows.latest} onSelect={setSelected} accent="none" />
        </div>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] py-6 text-[0.68rem] text-white/25">
        <span>
          Catalog &amp; streams: CircleFTP · a personal companion, not affiliated with CircleFTP.
        </span>
        <span className="flex items-center gap-1.5">
          <OpenIcon width={12} height={12} /> Playback follows CircleFTP’s own access rules.
        </span>
      </footer>

      <DetailModal
        item={selected}
        onClose={() => setSelected(null)}
        onFindSimilar={(detail: Detail) => {
          setSelected(null)
          navigate(`/?similar=${encodeURIComponent(detail.slug)}`)
        }}
      />
    </main>
  )
}
