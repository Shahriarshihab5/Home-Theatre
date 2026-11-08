/**
 * Actor / director lookups for the movie assistant.
 *
 * CircleFTP leaves its "Actor" and "Director" fields empty on every title, so
 * the catalog alone cannot answer "shah rukh khan movies". This module resolves
 * a person through Wikidata (free, no API key) and returns the films they are
 * credited in. Titles are then matched against the verified CircleFTP snapshot
 * by catalog.js — Wikidata is never used to claim availability.
 *
 * Everything is cached on disk so the TV keeps working when Wikipedia or
 * Wikidata is unreachable, and so repeat questions are instant.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasCatalogTitle, titleKey } from './catalog.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')
const CACHE_FILE = path.join(DATA_DIR, 'people-cache.json')

const WIKI_API = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'HomeMovieTheatre/1.0 (personal home TV app; local network)'

const FILM_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days
const MISS_TTL = 3 * 24 * 60 * 60 * 1000 // 3 days
const NETWORK_TIMEOUT = 7000

/* ───────────────────────────── name parsing ───────────────────────────── */

const STOPWORDS = new Set(
  (
    'a an the of in on at for to with by from and or is are was were be been being this that these those ' +
    'me my our your his her their i we you they it its as about into over under again more most some any ' +
    'all both each few other such no nor not only own same so than too very can will just should now ' +
    'find search looking look show tell give please want wanna need would could'
  ).split(/\s+/),
)

const INTENT_WORDS = new Set(
  (
    'movie movies film films picture pictures show shows series watch watching tonight today tomorrow ' +
    'evening night something anything good great best nice new old classic classics top rated rating ' +
    'popular famous must see seen watchlist maybe ready bored fun funny recommend recommendation ' +
    'recommendations suggest suggestion pick picks actor actress starring featuring cast crew directed ' +
    'director produced producer written writer music musical song songs'
  ).split(/\s+/),
)

const GENRE_WORDS = new Set(
  (
    'action comedy comedic funny drama dramatic thriller suspense horror scary romance romantic love ' +
    'family kids children animation animated cartoon anime crime gangster mafia mystery detective ' +
    'sci-fi scifi si-fi science fiction fantasy magic adventure quest biography biographical true story ' +
    'war army military sport sports history historical document documentary musical music dance'
  ).split(/\s+/),
)

const COUNTRY_WORDS = new Set(
  (
    'indian india bollywood hindi hollywood american usa british uk korean korea japanese japan chinese ' +
    'china thai thailand turkish turkey french france spanish spain german germany russian russia ' +
    'indonesian indonesia italian italy brazilian brazil mexican mexico'
  ).split(/\s+/),
)

const NON_PERSON_WORDS = new Set(
  (
    'marvel dc oscar oscars imdb netflix prime disney pixar superhero superheroes franchise ' +
    'trailer trailers review reviews imdb rating sequel prequel remake reboot'
  ).split(/\s+/),
)

/**
 * Pull the most likely person name out of a spoken request.
 * Returns null when the request is just a genre/country/mood.
 */
export function extractPersonName(message) {
  const raw = String(message || '')
    .normalize('NFKC')
    .replace(/[’']s\b/gi, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return null

  const tokens = raw
    .split(' ')
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word))
    .filter((word) => !INTENT_WORDS.has(word))
    .filter((word) => !GENRE_WORDS.has(word))
    .filter((word) => !COUNTRY_WORDS.has(word))

  if (!tokens.length || tokens.length > 4) return null
  if (tokens.some((token) => /\d/.test(token))) return null
  if (tokens.some((token) => NON_PERSON_WORDS.has(token))) return null

  const phrase = tokens.join(' ')
  // A single token is only worth a lookup if it is not an ordinary word and is
  // not already a catalog title (that title path is handled by catalog search).
  if (tokens.length === 1 && (phrase.length < 3 || hasCatalogTitle(phrase))) return null
  if (tokens.length > 1 && hasCatalogTitle(phrase)) return null

  // A name is usually 2–3 words. A 4-word run is suspicious; keep the last 3
  // because "movies of the actor shah rukh khan" reduces to a clean name.
  const name = tokens.length === 4 ? tokens.slice(-3).join(' ') : phrase
  if (!/[a-z]/.test(name)) return null
  return name
}

/* ───────────────────────────── HTTP helpers ───────────────────────────── */

async function fetchJSON(url, { timeout = NETWORK_TIMEOUT, ...init } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/* ─────────────────────────────── cache ─────────────────────────────── */

let cache = { names: {}, people: {}, misses: {} }
let saveTimer = null

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      cache = {
        names: parsed.names || {},
        people: parsed.people || {},
        misses: parsed.misses || {},
      }
    }
  } catch {
    /* first run */
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const tmp = `${CACHE_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(cache))
      fs.renameSync(tmp, CACHE_FILE)
    } catch {
      /* cache is an optimisation, never fatal */
    }
  }, 1500)
  saveTimer.unref?.()
}

loadCache()

/* ───────────────────────────── Wikidata ───────────────────────────── */

const ACTOR_DESCRIPTION = /actor|actress|cast member|film director|filmmaker|film producer|screenwriter|comedian|performer/i

/**
 * Wikipedia search handles common misspellings ("amir khan", "sharuk khan")
 * that Wikidata's prefix search ranks below non-actors.
 */
async function wikipediaQids(name) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    // Plain keywords work better than OR syntax: "amir khan actor" finds
    // Aamir Khan even though the spelling differs by one vowel.
    gsrsearch: `${name} actor`,
    gsrlimit: '3',
    prop: 'pageprops',
    format: 'json',
    origin: '*',
  })
  try {
    const data = await fetchJSON(`${WIKIPEDIA_API}?${params}`, { timeout: 6000 })
    const pages = Object.values(data?.query?.pages || {})
    return pages
      .map((page) => page?.pageprops?.wikibase_item)
      .filter((qid) => /^Q\d+$/.test(String(qid || '')))
  } catch {
    return null
  }
}

async function wikidataSearch(name) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '8',
    format: 'json',
  })
  try {
    const data = await fetchJSON(`${WIKI_API}?${params}`, { timeout: 6000 })
    return (data?.search || []).map((item) => ({
      id: item.id,
      label: item.label || '',
      description: item.description || '',
    }))
  } catch {
    return null
  }
}

/** All films a person is credited in (as cast, or as director). */
async function filmographyQid(qid, role = 'cast') {
  const property = role === 'director' ? 'P57' : 'P161'
  const query = `SELECT ?film ?filmLabel ?year WHERE {
  ?film wdt:${property} wd:${qid} .
  ?film wdt:P31/wdt:P279* wd:Q11424 .
  OPTIONAL { ?film wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 600`

  try {
    const data = await fetchJSON(SPARQL_ENDPOINT, {
      method: 'POST',
      timeout: 12000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
      },
      body: new URLSearchParams({ query }).toString(),
    })
    const bindings = data?.results?.bindings || []
    const films = []
    const seen = new Set()
    for (const row of bindings) {
      const title = row?.filmLabel?.value || ''
      if (!title || /^Q\d+$/.test(title)) continue
      const year = Number(row?.year?.value) || null
      const key = `${titleKey(title)}|${year || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      films.push({ title, year })
    }
    return films
  } catch {
    return null
  }
}

/* ───────────────────────────── resolution ───────────────────────────── */

const inflight = new Map()

async function entityLabel(qid) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'labels|descriptions',
    languages: 'en',
    format: 'json',
  })
  try {
    const data = await fetchJSON(`${WIKI_API}?${params}`, { timeout: 5000 })
    const entity = data?.entities?.[qid]
    return {
      name: entity?.labels?.en?.value || '',
      description: entity?.descriptions?.en?.value || '',
    }
  } catch {
    return { name: '', description: '' }
  }
}

function cachedPerson(qid) {
  const hit = cache.people[qid]
  if (!hit) return null
  if (Date.now() - hit.at > FILM_TTL) return null
  return hit
}

/**
 * Resolve a free-text name to a person and their filmography.
 * Returns { id, name, description, films, role } or null.
 */
export async function resolvePerson(name) {
  const query = String(name || '').trim()
  if (!query) return null
  const key = titleKey(query)
  if (!key || key.length < 3) return null

  const named = cache.names[key]
  if (named) {
    const person = cachedPerson(named.qid)
    if (person && Date.now() - named.at <= FILM_TTL) return person
  }
  const missedAt = cache.misses[key]
  if (missedAt && Date.now() - missedAt < MISS_TTL) return null

  if (inflight.has(key)) return inflight.get(key)

  const promise = (async () => {
    let networkFailed = false
    const candidates = await wikidataSearch(query)
    if (candidates === null) {
      networkFailed = true
    }
    const actorish = (candidates || []).filter((item) => ACTOR_DESCRIPTION.test(item.description))
    const ordered = [
      ...actorish.filter((item) => titleKey(item.label) === key),
      ...actorish.filter((item) => titleKey(item.label) !== key),
    ]

    // Primary: an actor/director Wikidata already ranks for this spelling.
    for (const candidate of ordered.slice(0, 2)) {
      try {
        const person = await loadPerson(candidate.id, candidate.label, candidate.description)
        if (person && person.films.length) return remember(key, person)
      } catch {
        networkFailed = true
      }
    }

    // Fallback: Wikipedia search copes with misspellings and stage names.
    const qids = await wikipediaQids(query)
    if (qids === null) {
      networkFailed = true
    }
    for (const qid of (qids || []).slice(0, 2)) {
      const meta = await entityLabel(qid)
      try {
        const person = await loadPerson(qid, meta.name || query, meta.description)
        if (person && person.films.length >= 2) return remember(key, person)
      } catch {
        networkFailed = true
      }
    }

    // Never cache a miss caused by an outage or rate limit — only cache a
    // genuine "no such person" answer, so a transient failure does not hide
    // an actor for days.
    if (!networkFailed) {
      cache.misses[key] = Date.now()
      scheduleSave()
    }
    return null
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

function remember(key, person) {
  cache.names[key] = { at: Date.now(), qid: person.id }
  cache.people[person.id] = { ...person, at: Date.now() }
  delete cache.misses[key]
  scheduleSave()
  return person
}

async function loadPerson(qid, fallbackName, description = '') {
  const existing = cachedPerson(qid)
  if (existing) return existing

  let films = await filmographyQid(qid, 'cast')
  if (films === null) throw new Error('Filmography lookup failed')
  let role = 'cast'
  if (!films.length && /director|filmmaker|screenwriter/i.test(description)) {
    films = await filmographyQid(qid, 'director')
    if (films === null) throw new Error('Filmography lookup failed')
    role = 'director'
  }
  if (!films.length) return null

  const meta = fallbackName ? { name: fallbackName, description } : await entityLabel(qid)
  return {
    id: qid,
    name: meta.name || fallbackName || qid,
    description: meta.description || description,
    films,
    role,
  }
}

/** Convenience: resolve the person inside a natural-language request. */
export async function resolvePersonInQuery(message) {
  const name = extractPersonName(message)
  if (!name) return null
  return resolvePerson(name)
}

/** Test/debug helper. */
export function peopleCacheStats() {
  return {
    people: Object.keys(cache.people).length,
    names: Object.keys(cache.names).length,
    misses: Object.keys(cache.misses).length,
  }
}
