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
const SELF_ALIASES = ['me', 'myself', 'mine', 'my taste', 'my profile', 'i']

/**
 * Work out who a request is for, e.g. "something for Olive",
 * "recommend for my mother", "what should I watch".
 * Returns null when the request doesn't name anyone.
 *
 * `activeProfile` matters for words like "me"/"my taste": they belong to
 * whoever is selected now, not always to the default profile.
 */
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
  // Everyone else first (mother, brother, added people), owner last so that
  // words like "me" don't steal a request that names someone else.
  const ordered = [...profiles.filter((p) => p.id !== owner?.id), owner].filter(Boolean) as Profile[]

  for (const profile of ordered) {
    const isOwner = profile.id === owner?.id
    const aliases = [...profile.aliases, profile.name.toLowerCase()].filter(
      (alias) => isOwner || !SELF_ALIASES.includes(alias.toLowerCase()),
    )
    if (isOwner) aliases.push(...SELF_ALIASES)
    for (const alias of aliases) {
      if (!alias) continue
      const pattern = new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`, 'i')
      if (pattern.test(haystack)) return profile.id
    }
  }

  // Group viewing, e.g. "something we can watch together".
  for (const alias of GROUP_PROFILE.aliases) {
    const pattern = new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`, 'i')
    if (pattern.test(haystack)) return GROUP_PROFILE_ID
  }

  return null
}
