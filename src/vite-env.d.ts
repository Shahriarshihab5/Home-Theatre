/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional backend base URL (e.g. a Cloudflare Tunnel for the home server). */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
