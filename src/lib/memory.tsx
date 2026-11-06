import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { db } from './db'
import {
  BUILTIN_PROFILES,
  DEFAULT_PROFILE,
  GROUP_PROFILE,
  GROUP_PROFILE_ID,
  isGroupProfile,
  MAX_PROFILES,
  makeProfile,
  profileById,
  type Profile,
  type ProfileId,
} from './profiles'
import type {
  CatalogItem,
  HistoryEntry,
  Prefs,
  RatingEntry,
  Taste,
  WatchlistEntry,
} from '../types'

const DEFAULT_PREFS: Prefs = {
  preferHindi: true,
  familyOnly: false,
  tts: true,
  voiceLang: 'en',
  voiceGender: 'female',
}
const EMPTY_TASTE: Taste = { genres: {}, countries: {} }

interface RateTarget extends CatalogItem {
  genres?: string[]
  country?: string
}

interface ProfileSnapshot {
  id: ProfileId
  name: string
  prefs: Prefs
  memory: {
    likes: { slug: string; title: string; genres?: string[]; country?: string }[]
    dislikes: { slug: string; title: string; genres?: string[]; country?: string }[]
    watched: { slug: string; title: string }[]
    watchlist: { slug: string; title: string }[]
    taste: Taste
  }
}

interface MemoryValue {
  ready: boolean
  profile: ProfileId
  profileName: string
  profiles: Profile[]
  setProfile: (id: ProfileId) => void
  addProfile: (name: string) => Profile
  renameProfile: (id: ProfileId, name: string) => void
  removeProfile: (id: ProfileId) => Promise<void>
  prefs: Prefs
  history: HistoryEntry[]
  watchlist: WatchlistEntry[]
  ratings: Record<string, RatingEntry>
  taste: Taste
  likes: RatingEntry[]
  dislikes: RatingEntry[]
  watched: HistoryEntry[]
  continueWatching: HistoryEntry[]
  setPrefs: (partial: Partial<Prefs>) => void
  rate: (item: RateTarget, value: 'like' | 'dislike' | null) => void
  toggleWatchlist: (item: RateTarget) => void
  saveProgress: (item: RateTarget, positionSec: number, durationSec: number) => void
  markCompleted: (item: RateTarget) => void
  removeHistory: (slug: string) => void
  removeWatchlist: (slug: string) => void
  refresh: () => Promise<void>
  exportMemory: () => Promise<void>
  resetMemory: () => Promise<void>
  memorySummary: () => Record<string, unknown>
  snapshotFor: (id: ProfileId) => ProfileSnapshot
}

const MemoryContext = createContext<MemoryValue | null>(null)

function bumpTaste(taste: Taste, target: RateTarget, delta: number): Taste {
  const next: Taste = { genres: { ...taste.genres }, countries: { ...taste.countries } }
  for (const genre of target.genres || []) {
    const key = genre.trim()
    if (!key) continue
    next.genres[key] = Math.max(-12, Math.min(24, (next.genres[key] || 0) + delta))
  }
  if (target.country) {
    const key = target.country.trim()
    if (key) next.countries[key] = Math.max(-12, Math.min(24, (next.countries[key] || 0) + delta * 0.7))
  }
  return next
}

export function MemoryProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>(BUILTIN_PROFILES)
  const [profileId, setProfileIdState] = useState<ProfileId>(DEFAULT_PROFILE)
  const [prefsAll, setPrefsAll] = useState<Record<string, Prefs>>({})
  const [tastes, setTastes] = useState<Record<string, Taste>>({})
  const [historyAll, setHistoryAll] = useState<HistoryEntry[]>([])
  const [watchlistAll, setWatchlistAll] = useState<WatchlistEntry[]>([])
  const [ratingsAll, setRatingsAll] = useState<RatingEntry[]>([])

  const persistCustomProfiles = useCallback((list: Profile[]) => {
    const custom = list.filter((p) => !p.builtin)
    void db.putKV(custom, 'customProfiles')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const storedCustom = await db.get<Profile[]>('kv', 'customProfiles')
      const custom = Array.isArray(storedCustom)
        ? storedCustom
            .filter((p) => p?.id && p?.name && !BUILTIN_PROFILES.some((b) => b.id === p.id))
            .map((p) => ({ ...p, builtin: false, aliases: [p.name.toLowerCase()] }))
            .slice(0, MAX_PROFILES - BUILTIN_PROFILES.length)
        : []
      const list = [...BUILTIN_PROFILES, ...custom]

      const [storedProfile, storedPrefs, storedTastes, history, watchlist, ratings] = await Promise.all([
        db.get<string>('kv', 'activeProfile'),
        Promise.all(list.map((p) => db.get<Prefs>('kv', `prefs:${p.id}`))),
        Promise.all(list.map((p) => db.get<Taste>('kv', `taste:${p.id}`))),
        db.kind<HistoryEntry>('history'),
        db.kind<WatchlistEntry>('watchlist'),
        db.kind<RatingEntry>('ratings'),
      ])

      setProfiles(list)
      if (
        storedProfile &&
        (storedProfile === GROUP_PROFILE_ID || list.some((p) => p.id === storedProfile))
      ) {
        setProfileIdState(storedProfile)
      }

      const nextPrefs: Record<string, Prefs> = {}
      const nextTastes: Record<string, Taste> = {}
      list.forEach((p, i) => {
        if (storedPrefs[i]) nextPrefs[p.id] = { ...DEFAULT_PREFS, ...storedPrefs[i] }
        if (storedTastes[i]) nextTastes[p.id] = storedTastes[i] as Taste
      })
      setPrefsAll(nextPrefs)
      setTastes(nextTastes)
      setHistoryAll((history || []).map((h) => ({ ...h, profile: h.profile || DEFAULT_PROFILE })))
      setWatchlistAll((watchlist || []).map((w) => ({ ...w, profile: w.profile || DEFAULT_PROFILE })))
      setRatingsAll((ratings || []).map((r) => ({ ...r, profile: r.profile || DEFAULT_PROFILE })))
    } catch (err) {
      console.warn('Could not load memory', err)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setProfile = useCallback(
    (id: ProfileId) => {
      const valid =
        id === GROUP_PROFILE_ID || profiles.some((p) => p.id === id) ? id : DEFAULT_PROFILE
      setProfileIdState(valid)
      void db.putKV(valid, 'activeProfile')
    },
    [profiles],
  )

  const addProfile = useCallback(
    (name: string): Profile => {
      const created = makeProfile(
        name,
        profiles.map((p) => p.id),
      )
      const next = [...profiles, created]
      setProfiles(next)
      persistCustomProfiles(next)
      setProfileIdState(created.id)
      void db.putKV(created.id, 'activeProfile')
      return created
    },
    [profiles, persistCustomProfiles],
  )

  const renameProfile = useCallback(
    (id: ProfileId, name: string) => {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      if (!clean) return
      const next = profiles.map((p) =>
        p.id === id && !p.builtin
          ? { ...p, name: clean, aliases: [clean.toLowerCase()] }
          : p,
      )
      setProfiles(next)
      persistCustomProfiles(next)
    },
    [profiles, persistCustomProfiles],
  )

  const removeProfile = useCallback(
    async (id: ProfileId) => {
      const target = profiles.find((p) => p.id === id)
      if (!target || target.builtin) return
      const next = profiles.filter((p) => p.id !== id)
      setProfiles(next)
      persistCustomProfiles(next)

      if (profileId === id) {
        setProfileIdState(DEFAULT_PROFILE)
        void db.putKV(DEFAULT_PROFILE, 'activeProfile')
      }

      await db.resetProfile(id)
      setPrefsAll((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      setTastes((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      setHistoryAll((prev) => prev.filter((h) => h.profile !== id))
      setWatchlistAll((prev) => prev.filter((w) => w.profile !== id))
      setRatingsAll((prev) => prev.filter((r) => r.profile !== id))
    },
    [profiles, profileId, persistCustomProfiles],
  )

  const setPrefs = useCallback(
    (partial: Partial<Prefs>) => {
      // In "All" mode a preference change applies to every person.
      const targets = isGroupProfile(profileId) ? profiles.map((p) => p.id) : [profileId]
      setPrefsAll((prev) => {
        const next = { ...prev }
        for (const id of targets) {
          const merged = { ...(prev[id] || DEFAULT_PREFS), ...partial }
          void db.putKV(merged, `prefs:${id}`)
          next[id] = merged
        }
        return next
      })
    },
    [profileId, profiles],
  )

  const updateTaste = useCallback((targetProfile: string, delta: number, item: RateTarget) => {
    setTastes((prev) => {
      const next = bumpTaste(prev[targetProfile] || EMPTY_TASTE, item, delta)
      void db.putKV(next, `taste:${targetProfile}`)
      return { ...prev, [targetProfile]: next }
    })
  }, [])

  const isGroup = isGroupProfile(profileId)

  /* ── combined view for "All" (group watching) ─────────────────────────── */

  const combinedHistory = useMemo(() => {
    const bySlug = new Map<string, HistoryEntry>()
    for (const h of historyAll) {
      const prev = bySlug.get(h.slug)
      if (!prev || h.updatedAt > prev.updatedAt) bySlug.set(h.slug, h)
      else if (h.completed && !prev.completed) bySlug.set(h.slug, { ...prev, completed: true })
    }
    return [...bySlug.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [historyAll])

  const combinedWatchlist = useMemo(() => {
    const bySlug = new Map<string, WatchlistEntry>()
    for (const w of watchlistAll) {
      const prev = bySlug.get(w.slug)
      if (!prev || w.addedAt > prev.addedAt) bySlug.set(w.slug, w)
    }
    return [...bySlug.values()].sort((a, b) => b.addedAt - a.addedAt)
  }, [watchlistAll])

  const combinedRatings = useMemo(() => {
    const score = new Map<string, number>()
    const latest = new Map<string, RatingEntry>()
    for (const r of ratingsAll) {
      score.set(r.slug, (score.get(r.slug) || 0) + (r.value === 'like' ? 1 : -1))
      const prev = latest.get(r.slug)
      if (!prev || r.at > prev.at) latest.set(r.slug, r)
    }
    const out: Record<string, RatingEntry> = {}
    for (const [slug, entry] of latest) {
      const net = score.get(slug) || 0
      if (net === 0) continue
      out[slug] = { ...entry, value: net > 0 ? 'like' : 'dislike' }
    }
    return out
  }, [ratingsAll])

  const combinedTaste = useMemo(() => {
    const genres: Record<string, number> = {}
    const countries: Record<string, number> = {}
    for (const p of profiles) {
      const t = tastes[p.id]
      if (!t) continue
      for (const [genre, value] of Object.entries(t.genres || {})) {
        genres[genre] = (genres[genre] || 0) + value
      }
      for (const [country, value] of Object.entries(t.countries || {})) {
        countries[country] = (countries[country] || 0) + value
      }
    }
    return { genres, countries }
  }, [profiles, tastes])

  const combinedPrefs = useMemo<Prefs>(() => {
    const list = profiles.map((p) => prefsAll[p.id]).filter(Boolean) as Prefs[]
    if (!list.length) return DEFAULT_PREFS
    return {
      preferHindi: list.some((p) => p.preferHindi),
      familyOnly: list.every((p) => p.familyOnly),
      tts: list.some((p) => p.tts),
      voiceLang: list[0]?.voiceLang ?? DEFAULT_PREFS.voiceLang,
      voiceGender: list[0]?.voiceGender ?? DEFAULT_PREFS.voiceGender,
    }
  }, [profiles, prefsAll])

  const prefs = isGroup ? combinedPrefs : prefsAll[profileId] || DEFAULT_PREFS
  const taste = isGroup ? combinedTaste : tastes[profileId] || EMPTY_TASTE

  const history = useMemo(() => {
    if (isGroup) return combinedHistory
    return historyAll.filter((h) => h.profile === profileId).sort((a, b) => b.updatedAt - a.updatedAt)
  }, [historyAll, profileId, isGroup, combinedHistory])

  const watchlist = useMemo(() => {
    if (isGroup) return combinedWatchlist
    return watchlistAll.filter((w) => w.profile === profileId).sort((a, b) => b.addedAt - a.addedAt)
  }, [watchlistAll, profileId, isGroup, combinedWatchlist])

  const ratings = useMemo(() => {
    if (isGroup) return combinedRatings
    return Object.fromEntries(
      ratingsAll.filter((r) => r.profile === profileId).map((r) => [r.slug, r]),
    ) as Record<string, RatingEntry>
  }, [ratingsAll, profileId, isGroup, combinedRatings])

  // "All" writes to every person; a single profile writes only to itself.
  const writeTargets = useMemo(
    () => (isGroup ? profiles.map((p) => p.id) : [profileId]),
    [isGroup, profiles, profileId],
  )

  const rate = useCallback(
    (item: RateTarget, value: 'like' | 'dislike' | null) => {
      const targetSet = new Set(writeTargets)
      const existingById = new Map(
        writeTargets.map((id) => [
          id,
          ratingsAll.find((r) => r.profile === id && r.slug === item.slug),
        ]),
      )
      const kept = ratingsAll.filter((r) => !(targetSet.has(r.profile) && r.slug === item.slug))
      const entries: RatingEntry[] = []

      for (const id of writeTargets) {
        const existing = existingById.get(id)
        if (value === null) {
          void db.deleteRecord('ratings', id, item.slug)
          updateTaste(id, -1, item)
          continue
        }

        const entry: RatingEntry = {
          slug: item.slug,
          title: item.title,
          thumb: item.thumb,
          genres: item.genres,
          country: item.country,
          value,
          at: Date.now(),
          profile: id,
        }
        entries.push(entry)
        void db.putRecord('ratings', id, entry)

        const delta = value === 'like' ? 2 : -2
        const undo = existing?.value === 'like' ? -2 : existing?.value === 'dislike' ? 2 : 0
        updateTaste(id, delta + undo, item)
      }

      setRatingsAll([...kept, ...entries])
    },
    [ratingsAll, writeTargets, updateTaste],
  )

  const toggleWatchlist = useCallback(
    (item: RateTarget) => {
      const targetSet = new Set(writeTargets)
      const exists = watchlistAll.some((w) => targetSet.has(w.profile) && w.slug === item.slug)

      if (exists) {
        for (const id of writeTargets) void db.deleteRecord('watchlist', id, item.slug)
        setWatchlistAll((prev) =>
          prev.filter((w) => !(targetSet.has(w.profile) && w.slug === item.slug)),
        )
        return
      }

      const entries = writeTargets.map((id): WatchlistEntry => ({
        slug: item.slug,
        title: item.title,
        thumb: item.thumb,
        quality: item.quality,
        genres: item.genres,
        country: item.country,
        audio: item.audio,
        imdbRating: item.imdbRating,
        addedAt: Date.now(),
        profile: id,
      }))
      for (const entry of entries) {
        void db.putRecord('watchlist', entry.profile, entry)
        updateTaste(entry.profile, 0.5, item)
      }
      setWatchlistAll((prev) => [...prev, ...entries])
    },
    [watchlistAll, writeTargets, updateTaste],
  )

  const saveProgress = useCallback(
    (item: RateTarget, positionSec: number, durationSec: number) => {
      if (!Number.isFinite(positionSec) || positionSec < 3) return
      const completed = durationSec > 0 && positionSec / durationSec > 0.94
      const updated: HistoryEntry[] = []

      for (const id of writeTargets) {
        const existing = historyAll.find((h) => h.profile === id && h.slug === item.slug)
        const entry: HistoryEntry = {
          slug: item.slug,
          title: item.title,
          thumb: item.thumb || existing?.thumb,
          quality: item.quality || existing?.quality,
          genres: item.genres || existing?.genres,
          country: item.country || existing?.country,
          positionSec: completed ? durationSec : positionSec,
          durationSec: durationSec || existing?.durationSec || 0,
          updatedAt: Date.now(),
          completed: completed || Boolean(existing?.completed),
          profile: id,
        }
        updated.push(entry)
        void db.putRecord('history', id, entry)

        // Watching teaches the profile too: once a title passes ~25% it counts
        // as a taste signal, even if the person never presses Like.
        const prevRatio =
          existing && existing.durationSec ? existing.positionSec / existing.durationSec : 0
        const nextRatio = entry.durationSec ? entry.positionSec / entry.durationSec : 0
        if (!existing || (prevRatio < 0.25 && nextRatio >= 0.25)) {
          updateTaste(id, 1.5, item)
        }
      }

      const targetSet = new Set(writeTargets)
      setHistoryAll((prev) => [
        ...prev.filter((h) => !(targetSet.has(h.profile) && h.slug === item.slug)),
        ...updated,
      ])
    },
    [historyAll, writeTargets, updateTaste],
  )

  const markCompleted = useCallback(
    (item: RateTarget) => {
      const updated: HistoryEntry[] = []
      for (const id of writeTargets) {
        const existing = historyAll.find((h) => h.profile === id && h.slug === item.slug)
        const entry: HistoryEntry = {
          slug: item.slug,
          title: item.title,
          thumb: item.thumb || existing?.thumb,
          quality: item.quality || existing?.quality,
          genres: item.genres || existing?.genres,
          country: item.country || existing?.country,
          positionSec: existing?.durationSec || 0,
          durationSec: existing?.durationSec || 0,
          updatedAt: Date.now(),
          completed: true,
          profile: id,
        }
        updated.push(entry)
        void db.putRecord('history', id, entry)
        updateTaste(id, 0.75, item)
      }

      const targetSet = new Set(writeTargets)
      setHistoryAll((prev) => [
        ...prev.filter((h) => !(targetSet.has(h.profile) && h.slug === item.slug)),
        ...updated,
      ])
    },
    [historyAll, writeTargets, updateTaste],
  )

  const removeHistory = useCallback(
    (slug: string) => {
      const targetSet = new Set(writeTargets)
      for (const id of writeTargets) void db.deleteRecord('history', id, slug)
      setHistoryAll((prev) => prev.filter((h) => !(targetSet.has(h.profile) && h.slug === slug)))
    },
    [writeTargets],
  )

  const removeWatchlist = useCallback(
    (slug: string) => {
      const targetSet = new Set(writeTargets)
      for (const id of writeTargets) void db.deleteRecord('watchlist', id, slug)
      setWatchlistAll((prev) => prev.filter((w) => !(targetSet.has(w.profile) && w.slug === slug)))
    },
    [writeTargets],
  )

  const snapshotFor = useCallback(
    (id: ProfileId): ProfileSnapshot => {
      /* "Everyone": one combined view of the whole household. */
      if (isGroupProfile(id)) {
        const combinedHistoryFor = () => {
          const bySlug = new Map<string, HistoryEntry>()
          for (const h of historyAll) {
            const prev = bySlug.get(h.slug)
            if (!prev || h.updatedAt > prev.updatedAt) bySlug.set(h.slug, h)
            else if (h.completed && !prev.completed) bySlug.set(h.slug, { ...prev, completed: true })
          }
          return [...bySlug.values()]
        }
        const combinedWatchlistFor = () => {
          const bySlug = new Map<string, WatchlistEntry>()
          for (const w of watchlistAll) {
            const prev = bySlug.get(w.slug)
            if (!prev || w.addedAt > prev.addedAt) bySlug.set(w.slug, w)
          }
          return [...bySlug.values()]
        }
        const score = new Map<string, number>()
        const latest = new Map<string, RatingEntry>()
        for (const r of ratingsAll) {
          score.set(r.slug, (score.get(r.slug) || 0) + (r.value === 'like' ? 1 : -1))
          const prev = latest.get(r.slug)
          if (!prev || r.at > prev.at) latest.set(r.slug, r)
        }
        const genres: Record<string, number> = {}
        const countries: Record<string, number> = {}
        for (const p of profiles) {
          const t = tastes[p.id]
          if (!t) continue
          for (const [genre, value] of Object.entries(t.genres || {})) {
            genres[genre] = (genres[genre] || 0) + value
          }
          for (const [country, value] of Object.entries(t.countries || {})) {
            countries[country] = (countries[country] || 0) + value
          }
        }
        const prefList = profiles.map((p) => prefsAll[p.id]).filter(Boolean) as Prefs[]
        const groupPrefs: Prefs = prefList.length
          ? {
              preferHindi: prefList.some((p) => p.preferHindi),
              familyOnly: prefList.every((p) => p.familyOnly),
              tts: prefList.some((p) => p.tts),
              voiceLang: prefList[0]?.voiceLang ?? DEFAULT_PREFS.voiceLang,
              voiceGender: prefList[0]?.voiceGender ?? DEFAULT_PREFS.voiceGender,
            }
          : DEFAULT_PREFS

        const ratedEntries = [...latest.values()]
        const shaped = (r: RatingEntry) => ({
          slug: r.slug,
          title: r.title,
          genres: r.genres,
          country: r.country,
        })

        return {
          id,
          name: 'Everyone',
          prefs: groupPrefs,
          memory: {
            likes: ratedEntries.filter((r) => (score.get(r.slug) || 0) > 0).map(shaped),
            dislikes: ratedEntries.filter((r) => (score.get(r.slug) || 0) < 0).map(shaped),
            watched: combinedHistoryFor()
              .filter((x) => x.completed)
              .map(({ slug, title }) => ({ slug, title })),
            watchlist: combinedWatchlistFor().map(({ slug, title }) => ({ slug, title })),
            taste: { genres, countries },
          },
        }
      }

      const h = historyAll.filter((x) => x.profile === id)
      const r = ratingsAll.filter((x) => x.profile === id)
      const w = watchlistAll.filter((x) => x.profile === id)
      return {
        id,
        name: profileById(id, profiles).name,
        prefs: prefsAll[id] || DEFAULT_PREFS,
        memory: {
          likes: r.filter((x) => x.value === 'like').map(({ slug, title, genres, country }) => ({ slug, title, genres, country })),
          dislikes: r.filter((x) => x.value === 'dislike').map(({ slug, title, genres, country }) => ({ slug, title, genres, country })),
          watched: h.filter((x) => x.completed).map(({ slug, title }) => ({ slug, title })),
          watchlist: w.map(({ slug, title }) => ({ slug, title })),
          taste: tastes[id] || EMPTY_TASTE,
        },
      }
    },
    [historyAll, ratingsAll, watchlistAll, prefsAll, tastes, profiles],
  )

  const exportMemory = useCallback(async () => {
    const group = isGroupProfile(profileId)
    const data = group
      ? {
          profile: 'Everyone',
          combined: snapshotFor(GROUP_PROFILE_ID),
          people: profiles.map((p) => snapshotFor(p.id)),
          exportedAt: new Date().toISOString(),
        }
      : await db.exportProfile(profileId, prefs, taste)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `home-movie-theatre-${profileId}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [profileId, prefs, taste, profiles, snapshotFor])

  const resetMemory = useCallback(async () => {
    // In "All" mode this clears the whole household's memory.
    const targets = isGroupProfile(profileId) ? profiles.map((p) => p.id) : [profileId]
    await Promise.all(targets.map((id) => db.resetProfile(id)))
    setPrefsAll((prev) => {
      const next = { ...prev }
      for (const id of targets) delete next[id]
      return next
    })
    setTastes((prev) => {
      const next = { ...prev }
      for (const id of targets) delete next[id]
      return next
    })
    setHistoryAll((prev) => prev.filter((h) => !targets.includes(h.profile)))
    setWatchlistAll((prev) => prev.filter((w) => !targets.includes(w.profile)))
    setRatingsAll((prev) => prev.filter((r) => !targets.includes(r.profile)))
  }, [profileId, profiles])

  const values = useMemo<MemoryValue>(() => {
    const likes = Object.values(ratings).filter((r) => r.value === 'like')
    const dislikes = Object.values(ratings).filter((r) => r.value === 'dislike')
    const watched = history.filter((h) => h.completed)
    return {
      ready,
      profile: profileId,
      profileName: profileById(profileId, profiles).name,
      profiles,
      setProfile,
      addProfile,
      renameProfile,
      removeProfile,
      prefs,
      history,
      watchlist,
      ratings,
      taste,
      likes,
      dislikes,
      watched,
      continueWatching: history.filter((h) => !h.completed && h.positionSec > 10).slice(0, 12),
      setPrefs,
      rate,
      toggleWatchlist,
      saveProgress,
      markCompleted,
      removeHistory,
      removeWatchlist,
      refresh,
      exportMemory,
      resetMemory,
      memorySummary: () => snapshotFor(profileId).memory,
      snapshotFor,
    }
  }, [
    ready,
    profileId,
    profiles,
    setProfile,
    addProfile,
    renameProfile,
    removeProfile,
    prefs,
    history,
    watchlist,
    ratings,
    taste,
    setPrefs,
    rate,
    toggleWatchlist,
    saveProgress,
    markCompleted,
    removeHistory,
    removeWatchlist,
    refresh,
    exportMemory,
    resetMemory,
    snapshotFor,
  ])

  return <MemoryContext.Provider value={values}>{children}</MemoryContext.Provider>
}

export function useMemory(): MemoryValue {
  const ctx = useContext(MemoryContext)
  if (!ctx) throw new Error('useMemory must be used inside <MemoryProvider>')
  return ctx
}
