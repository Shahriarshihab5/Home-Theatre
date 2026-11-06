/**
 * Tiny promise-based IndexedDB wrapper. No dependencies.
 *
 * v2: memory is split per person (Shihab / Olive / Shahnaj) so each family
 * member gets their own likes, history, wishlist and taste profile.
 * Records are stored in dedicated stores with a composite key: "profile:slug".
 */

const DB_NAME = 'home-movie-theatre'
const DB_VERSION = 2

export type RecordKind = 'history' | 'watchlist' | 'ratings'
export type StoreName = 'kv' | 'p_history' | 'p_watchlist' | 'p_ratings'

const RECORD_STORE: Record<RecordKind, StoreName> = {
  history: 'p_history',
  watchlist: 'p_watchlist',
  ratings: 'p_ratings',
}

export interface StoredRecord {
  key: string
  profile: string
  slug: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const database = req.result
      const tx = req.transaction
      if (!tx) return

      if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv')
      for (const store of Object.values(RECORD_STORE)) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'key' })
      }

      // ── migrate v1 (single memory) into Shihab's profile ──────────────
      const migrateStore = (oldName: RecordKind, newName: StoreName) => {
        if (!database.objectStoreNames.contains(oldName)) return
        const old = tx.objectStore(oldName)
        const all = old.getAll()
        all.onsuccess = () => {
          const target = tx.objectStore(newName)
          for (const rec of all.result || []) {
            if (!rec?.slug) continue
            target.put({ ...rec, key: `shihab:${rec.slug}`, profile: 'shihab' })
          }
        }
      }
      migrateStore('history', 'p_history')
      migrateStore('watchlist', 'p_watchlist')
      migrateStore('ratings', 'p_ratings')

      // Old single preference/taste values belong to the owner.
      const kv = tx.objectStore('kv')
      const prefsReq = kv.get('prefs')
      prefsReq.onsuccess = () => {
        if (prefsReq.result) kv.put(prefsReq.result, 'prefs:shihab')
      }
      const tasteReq = kv.get('taste')
      tasteReq.onsuccess = () => {
        if (tasteReq.result) kv.put(tasteReq.result, 'taste:shihab')
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'))
  })
  return dbPromise
}

function request<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
      }),
  )
}

export const db = {
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return request<T | undefined>(store, 'readonly', (s) => s.get(key))
  },
  putKV<T>(value: T, key: string): Promise<IDBValidKey> {
    return request<IDBValidKey>('kv', 'readwrite', (s) => s.put(value, key))
  },
  deleteKV(key: string): Promise<void> {
    return request<void>('kv', 'readwrite', (s) => s.delete(key))
  },
  getAll<T>(store: StoreName): Promise<T[]> {
    return request<T[]>(store, 'readonly', (s) => s.getAll())
  },

  kind<T extends { slug: string; profile?: string }>(kind: RecordKind): Promise<T[]> {
    return db.getAll<T>(RECORD_STORE[kind])
  },

  putRecord<T extends { slug: string }>(kind: RecordKind, profile: string, value: T): Promise<IDBValidKey> {
    const record = { ...value, profile, key: `${profile}:${value.slug}` }
    return request<IDBValidKey>(RECORD_STORE[kind], 'readwrite', (s) => s.put(record))
  },

  deleteRecord(kind: RecordKind, profile: string, slug: string): Promise<void> {
    return request<void>(RECORD_STORE[kind], 'readwrite', (s) => s.delete(`${profile}:${slug}`))
  },

  async clearProfile(kind: RecordKind, profile: string): Promise<void> {
    const all = await db.getAll<StoredRecord>(RECORD_STORE[kind])
    await Promise.all(
      all
        .filter((r) => r.profile === profile)
        .map((r) => request<void>(RECORD_STORE[kind], 'readwrite', (s) => s.delete(r.key))),
    )
  },

  async exportProfile(profile: string, prefs: unknown, taste: unknown) {
    const [history, watchlist, ratings] = await Promise.all([
      db.getAll<StoredRecord>('p_history'),
      db.getAll<StoredRecord>('p_watchlist'),
      db.getAll<StoredRecord>('p_ratings'),
    ])
    const own = <T extends StoredRecord>(list: T[]) =>
      list.filter((r) => r.profile === profile).map(({ key: _key, ...rest }) => rest)
    return {
      app: 'home-movie-theatre',
      profile,
      exportedAt: new Date().toISOString(),
      prefs,
      taste,
      history: own(history),
      watchlist: own(watchlist),
      ratings: own(ratings),
    }
  },

  async resetProfile(profile: string): Promise<void> {
    await Promise.all([
      db.clearProfile('history', profile),
      db.clearProfile('watchlist', profile),
      db.clearProfile('ratings', profile),
      db.deleteKV(`taste:${profile}`),
      db.deleteKV(`prefs:${profile}`),
    ])
  },
}
