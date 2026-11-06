/**
 * Household profiles. Each person has isolated likes, history, wishlist and
 * taste, so the AI can recommend for the right person.
 *
 * The three originals are built in; more people can be added at runtime and
 * are stored in IndexedDB (kv: customProfiles).
 */

export type ProfileId = string

export interface Profile {
  id: ProfileId
  name: string
  role: string
  aliases: string[]
  builtin?: boolean
}

export const BUILTIN_PROFILES: Profile[] = [
  {
    id: 'shihab',
    name: 'Shihab',
    role: 'You',
    builtin: true,
    aliases: ['shihab', 'shehab', 'shahib', 'me', 'myself', 'mine', 'my taste'],
  },
  {
    id: 'olive',
    name: 'Olive',
    role: 'Brother',
    builtin: true,
    aliases: ['olive', 'olib', 'olibe', 'oliv', 'brother', 'bro', 'my brother'],
  },
  {
    id: 'shahnaj',
    name: 'Shahnaj',
    role: 'Mother',
    builtin: true,
    aliases: ['shahnaj', 'shahanaj', 'shahnaz', 'mother', 'mom', 'mum', 'maa', 'my mother'],
  },
]

/** Kept for backwards compatibility with older imports. */
export const PROFILES = BUILTIN_PROFILES
export const DEFAULT_PROFILE: ProfileId = 'shihab'
export const MAX_PROFILES = 8

/**
 * Special pseudo-profile for group viewing. It has no storage of its own:
 * taste, likes, history and wishlist are combined from every real person.
 */
export const GROUP_PROFILE_ID = 'all'
export const GROUP_PROFILE: Profile = {
  id: GROUP_PROFILE_ID,
  name: 'Everyone',
  role: 'Together',
  builtin: true,
  aliases: ['everyone', 'everybody', 'all of us', 'the three of us', 'the 3 of us', 'together', 'whole family', 'group'],
}

export function isGroupProfile(id?: string | null) {
  return id === GROUP_PROFILE_ID
}

export function profileById(id?: string | null, list: Profile[] = BUILTIN_PROFILES): Profile {
  if (id === GROUP_PROFILE_ID) return GROUP_PROFILE
  return list.find((p) => p.id === id) ?? list[0] ?? BUILTIN_PROFILES[0]
}

/** A safe, unique id for a newly added person. */
export function slugifyProfile(name: string): string {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return base || 'person'
}

export function uniqueProfileId(name: string, existingIds: string[]): string {
  const base = slugifyProfile(name)
  let id = base
  let n = 2
  while (existingIds.includes(id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

/** Build a new custom profile from a typed name. */
export function makeProfile(name: string, existingIds: string[], role = 'Family'): Profile {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30)
  if (!clean) throw new Error('Enter a name first')
  if (existingIds.length >= MAX_PROFILES) throw new Error(`You can have up to ${MAX_PROFILES} profiles`)
  if (existingIds.length && BUILTIN_PROFILES.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('That person already exists')
  }
  return {
    id: uniqueProfileId(clean, existingIds),
    name: clean,
    role,
    aliases: [clean.toLowerCase()],
    builtin: false,
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Self-references always mean the person who is currently active. */
const SELF_ALIASES = ['me', 'myself', 'mine', 'my taste', 'my profile']

/** Phrases that put a name in the role of the person being asked about. */
const REQUEST_PREPOSITIONS = new Set(['for', 'to', 'with'])
const TASTE_WORDS = new Set([
  'like', 'likes', 'liked', 'love', 'loves', 'loved', 'enjoy', 'enjoys',
  'prefer', 'prefers', 'want', 'wants', 'taste', 'type', 'fan', 'vibe', 'style', 'mood',
])
const QUESTION_WORDS = new Set(['would', 'does', 'did', 'will', 'should', 'can'])

/** Group phrases that are unambiguous on their own. */
const GROUP_ALWAYS = new Set([
  'everyone', 'everybody', 'together', 'group',
  'all of us', 'the three of us', 'the 3 of us', 'whole family',
])

/** Group phrasings that don't use one of the aliases above. */
const GROUP_PATTERN = /\b(?:we can all|we could all|for all of us|let'?s all|something together|watch (?:it )?together)\b/i

/**
 * Find where a name is used as the *target* of a request, e.g.
 * "something for Olive", "what would my mother like", "Olive's taste".
 *
 * A bare mention is not enough: "no brother, I don't like these" is how the
 * viewer talks, not a request to switch to Olive. Returns -1 when the name is
 * only being used conversationally.
 */
function intentIndex(haystack: string, alias: string, { self = false } = {}): number {
  const target = alias.trim().toLowerCase()
  if (!target) return -1
  if (target === 'my taste' || target === 'my profile') {
    return haystack.includes(target) ? haystack.indexOf(target) : -1
  }

  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(target)}(?=[^a-z0-9]|$)`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(haystack))) {
    const start = match.index + match[1].length
    const before = haystack.slice(Math.max(0, start - 40), start)
    const after = haystack.slice(start + target.length, start + target.length + 40)
    const beforeWords = before.split(/[^a-z']+/).filter(Boolean)
    const afterWords = after.split(/[^a-z']+/).filter(Boolean)
    const prev = beforeWords[beforeWords.length - 1] || ''
    const prev2 = beforeWords[beforeWords.length - 2] || ''

    // "for Olive", "to my brother": self words only count after "for" so that
    // "sounds good to me" doesn't look like a profile switch.
    if (REQUEST_PREPOSITIONS.has(prev) && (!self || prev === 'for')) return start
    // "my brother", "our mother"
    if (!self && (prev === 'my' || prev === 'our')) return start
    // "what about Olive", "how about my mother"
    if (prev === 'about' && (prev2 === 'what' || prev2 === 'how')) return start
    // "would Olive like", "does mother want"
    if (QUESTION_WORDS.has(prev)) return start
    // "Olive's taste", "brother’s picks"
    if (/^['’]s\b/i.test(after) || /^s\s+(taste|type|picks|movies|style|mood)\b/i.test(after)) return start
    // "Olive likes horror", "mother prefers drama", "brother is a fan"
    if (TASTE_WORDS.has(afterWords[0] || '')) return start
    if (afterWords[0] === 'is' && afterWords[1] === 'a' && afterWords[2] === 'fan') return start
  }
  return -1
}

/** The earliest profile the request is for, or null if nobody is named. */
export function detectProfile(
  text: string,
  profiles: Profile[] = BUILTIN_PROFILES,
  activeProfile: ProfileId = DEFAULT_PROFILE,
): ProfileId | null {
  const haystack = ` ${String(text || '').toLowerCase()} `
  const owner =
    profiles.find((p) => p.id === activeProfile) ??
    profiles.find((p) => p.id === DEFAULT_PROFILE) ??
    profiles[0]

  const hits: Array<{ id: ProfileId; at: number; order: number }> = []

  const groupPhrase = haystack.match(GROUP_PATTERN)
  if (groupPhrase?.index !== undefined) {
    hits.push({ id: GROUP_PROFILE_ID, at: groupPhrase.index, order: -1 })
  }

  // Group viewing: "something for everyone", "watch together".
  GROUP_PROFILE.aliases.forEach((alias, order) => {
    if (GROUP_ALWAYS.has(alias)) {
      const at = haystack.indexOf(alias)
      if (at >= 0) hits.push({ id: GROUP_PROFILE_ID, at, order })
      return
    }
    const at = intentIndex(haystack, alias)
    if (at >= 0) hits.push({ id: GROUP_PROFILE_ID, at, order })
  })

  // Everyone named in the sentence competes, so "for Olive and me" picks the
  // first person actually mentioned instead of relying on list order.
  profiles.forEach((profile, profileOrder) => {
    const isOwner = profile.id === owner?.id
    const aliases = [...profile.aliases, profile.name.toLowerCase()]
    aliases.forEach((alias) => {
      if (!alias) return
      const self = SELF_ALIASES.includes(alias.toLowerCase())
      if (self && !isOwner) return
      const at = intentIndex(haystack, alias, { self })
      if (at >= 0) hits.push({ id: profile.id, at, order: profileOrder + GROUP_PROFILE.aliases.length })
    })
  })

  if (!hits.length) {
    // "something I'd like" means the active person without naming them.
    if (/\b(?:something|anything|a movie|movies)\b[^.!?]{0,40}\bi(?:'d| would)\s+(?:like|love|enjoy)\b/i.test(haystack)) {
      return owner?.id ?? null
    }
    return null
  }

  hits.sort((a, b) => a.at - b.at || b.order - a.order)
  return hits[0].id
}
