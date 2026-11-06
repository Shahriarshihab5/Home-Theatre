import type { AiResult, CatalogItem, Detail, HealthInfo, HomeData, StreamInfo } from '../types'

const JSON_HEADERS = { Accept: 'application/json' }

/** Optional backend override (e.g. a Cloudflare Tunnel URL for the home server). */
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

const apiUrl = (path: string) => `${API_BASE}${path}`

async function getJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
    ...options,
    headers: { ...JSON_HEADERS, ...(options?.headers || {}) },
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Server returned invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

export const api = {
  home: () => getJSON<HomeData>('/api/home'),
  hindi: () => getJSON<{ movies: CatalogItem[]; series: CatalogItem[] }>('/api/hindi'),
  forYou: (body: { taste: unknown; exclude?: string[] }) =>
    getJSON<{ items: CatalogItem[] }>('/api/for-you', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  list: (type: 'genre' | 'country', slug: string, offset = 0) =>
    getJSON<{ items: CatalogItem[]; hasMore: boolean; nextOffset: number | null }>(
      `/api/list?type=${encodeURIComponent(type)}&slug=${encodeURIComponent(slug)}&offset=${offset}`,
    ),
  search: (q: string) => getJSON<{ query: string; items: CatalogItem[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  detail: (slug: string) => getJSON<Detail>(`/api/detail?slug=${encodeURIComponent(slug)}`),
  similar: (slug: string) => getJSON<AiResult>(`/api/similar?slug=${encodeURIComponent(slug)}`),
  recommend: (body: {
    message: string
    memory: unknown
    prefs: unknown
    referenceSlug?: string
    targetName?: string
    avoidSlugs?: string[]
    topic?: string
    history?: { role: 'user' | 'assistant'; text: string }[]
  }) =>
    getJSON<AiResult>('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  streamInfo: (slug: string) => getJSON<StreamInfo>(`/api/stream-info?slug=${encodeURIComponent(slug)}`),
  health: () => getJSON<HealthInfo>('/api/health'),
}

/**
 * Browser-friendly stream for a specific audio track.
 * `t` is the start position: the player restarts the stream when seeking.
 */
export function playUrl(slug: string, audioOrdinal = 0, startSec = 0): string {
  return apiUrl(
    `/api/play?slug=${encodeURIComponent(slug)}&a=${Math.max(0, audioOrdinal)}&t=${Math.max(0, Math.floor(startSec))}`,
  )
}

/** Direct in-page streaming only works when this app itself is served over HTTP.
 *  CircleFTP is HTTP-only, so an HTTPS page cannot play its video (mixed content). */
export const streamMode: 'direct' | 'external' = location.protocol === 'https:' ? 'external' : 'direct'

/** True when a same-origin HTTPS stream endpoint is available (LAN server or tunnel). */
export const hasStreamProxy = (info: StreamInfo | null): boolean => Boolean(info?.transcode)

/** Route CircleFTP's HTTP posters through our image proxy when running on HTTPS. */
export function imgSrc(url?: string): string {
  if (!url) return ''
  // The cloud copy ships 150px posters in /posters (CircleFTP images are HTTP-only,
  // so an HTTPS page cannot load them directly).
  const bundled = location.protocol === 'https:' ? url.match(/\/uploads\/video_thumb\/(\d+)\.jpg/i) : null
  if (bundled) return `/posters/${bundled[1]}.jpg`
  if (location.protocol !== 'https:') return url
  if (url.startsWith('http://')) return apiUrl(`/api/image?url=${encodeURIComponent(url)}`)
  return url
}

export function prettyTitle(raw: string): string {
  return raw.replace(/\s*\(\d{4}\)\s*$/, '').trim()
}

/** Friendly name for the active AI provider. */
export function aiProviderLabel(provider?: string): string {
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'deepseek') return 'DeepSeek'
  return 'AI'
}
