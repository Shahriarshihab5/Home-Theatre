# 🎬 Home Movie Theatre

A personal, voice-first movie & web-series companion for your TV — built around **your** CircleFTP catalog, with **Google Gemini (free tier)** as the recommendation brain. DeepSeek is supported as an optional alternative.

Every title the AI mentions is first fetched from CircleFTP and verified to exist. The model is never allowed to invent a movie, a rating, or an availability claim.

---

## What it does

| Feature | Details |
| --- | --- |
| **Ask for anything** | “Korean thriller in Hindi”, “Something like Breaking Bad”, “Family movie under 2 hours”. |
| **Grounded recommendations** | The model only sees titles scraped from CircleFTP; every returned slug is re-validated before display. |
| **Household profiles** | Separate memory for **Shihab** (you), **Olive** (brother) and **Shahnaj** (mother), plus an **All** profile that combines everyone's taste for watching together. Say “for Olive”, “for my mother” or “something we can all watch”. |
| **10–15 grounded picks** | Every AI answer returns 10–15 verified movie/series options, topped up from the catalog when the model is brief. |
| **Personalised rows** | Every row is re-ranked from this profile's likes, watch history and past AI requests. |
| **Persistent memory** | Likes, dislikes, watch history, resume points, wishlist and taste profile — stored in IndexedDB on the TV browser. |
| **Continue Watching** | Progress is saved every ~5 s while playing and resumes where you left off. |
| **History & Wishlist** | Dedicated pages for everything watched/started and everything saved for later. |
| **Hindi sections** | Split **Hindi Movies** and **Hindi Web Series**, confirmed from the stream filename. |
| **Remote-first UI + nav bar** | Persistent navigation for Home, Hindi, History, Wishlist, Search and profiles, with D-pad spatial navigation and large gold focus rings. |
| **Voice + remote typing** | Uses the browser's Web Speech API where available (English). No on-screen keyboard — select the box and use the TV remote's own keyboard, or press **Voice**. |
| **Honest metadata** | Audio languages are read from the actual stream filename (`[Hindi+Tamil]`, `Hindi Dubbed`, `Dual Audio`). When unknown, the UI says so. |
| **Playback performance mode** | Blur/fixed-background effects are disabled and animations are paused while video plays, so the TV browser stays responsive. |
| **Interface sounds** | Soft D-pad ticks, a selection pop and a chime when the AI finds new picks. Can be turned off in Settings. |
| **Export / reset** | Download your full profile memory as JSON, or wipe it in two taps. |

---

## Requirements

- **Node.js 18+** (tested on Node 22)
- Internet access to `hd.circleftp.net` (the server scrapes the catalog)
- A **free** Gemini API key: <https://aistudio.google.com/apikey> (no credit card needed)
- Optional: a free TMDB key for nicer posters/ratings
- Optional: a DeepSeek key if you prefer that provider

---

## Quick start

```bash
cd home-movie-theatre
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

Open `.env` and add your Gemini key:

```ini
GEMINI_API_KEY=your-free-key-here
```

Then:

```bash
npm run build     # build the TV UI once
npm start         # start the server
```

The console prints two URLs:

```
Local:   http://localhost:8787
TV:      http://192.168.x.x:8787   ← open this on your TV browser
```

Open the **TV** URL in the browser on your Android TV (or on your phone/PC) and bookmark it. Both devices must be on the same Wi-Fi network.

### Development mode

```bash
npm run dev
```

Runs the API on `:8787` and Vite with hot reload on `:5173` (proxying `/api`). Use `http://localhost:5173` on your PC.

---

## Configuration (`.env`)

### AI — Gemini (default, free tier)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | **Required for AI.** Free from Google AI Studio. Server-side only; never sent to the browser. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Best free balance of speed and quality. |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Used automatically if the main model is overloaded (503) or out of quota (429). |
| `GEMINI_THINKING_LEVEL` | `low` | `low` / `minimal` / `high`. Lower is faster — better for TV. |

> Old `gemini-2.5-*` IDs return 404 for keys created after September 2026. Use the 3.x Flash models.

### AI — provider selection & optional DeepSeek

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `auto` | `auto` (Gemini, then DeepSeek), `gemini`, `deepseek`, or `local`. |
| `DEEPSEEK_API_KEY` | — | Optional alternative provider. |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Served by DeepSeek-V4.1-Flash. `deepseek-v4-pro` also works. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible endpoint. |
| `DEEPSEEK_THINKING` | `disabled` | Keeps replies fast. |

### Metadata & server

| Variable | Default | Purpose |
| --- | --- | --- |
| `TMDB_API_KEY` | — | Optional poster/rating enrichment. Availability still comes from CircleFTP only. |
| `PORT` | `8787` | Server port. |
| `CATALOG_BASE` | `http://hd.circleftp.net` | Catalog source. |
| `DETAIL_TTL_MINUTES` | `720` | How long a title's detail page is cached in memory. |

If no AI key is configured, the app **still works**: it falls back to a local taste-based recommender ranked from your memory + CircleFTP listings. The UI labels this clearly as “local ranking” and the header badge says **Local picks** instead of **Gemini online**.

### About the key and “Gemini memory”

The Gemini **API** is a stateless endpoint. It does **not** read the chat history or personal memory from your Gemini consumer app — each request starts fresh. Personalisation comes entirely from this app's own memory (likes, dislikes, watch history, watchlist, taste profile), which is stored in the TV browser and sent as a compact summary with each request. That's also why a dedicated free key is preferable to reusing your personal one: it keeps quotas and billing isolated.

---

## Household profiles

Each person has their own likes, dislikes, watch history, wishlist and taste profile. Switch with the profile buttons in the top-right of the navigation bar, or just name the person:

| You say | The AI uses |
| --- | --- |
| “What should I watch?” | The currently selected profile. |
| “Something for Olive”, “for my brother” | Olive's memory. |
| “Recommend for my mother”, “for Shahnaj” | Shahnaj's memory. |
| “For Shihab” / “for me” | Shihab's memory. |
| “Watch together”, “for everyone”, “all of us” | The **All** profile — combined taste, likes, history and wishlist. |

Names and common variants are understood on both the client (to pick the memory) and the server (to address the answer). In **All** mode, likes, saves and viewing progress are written to every person's profile, so a family session teaches everyone. Use the **Add** button next to the profiles to create more people.

---

## Using it with the TV remote

| Key | Action |
| --- | --- |
| Arrow buttons | Move focus between nav buttons, posters, chips and buttons |
| OK / Enter | Select the focused item |
| Back / Escape | Close a dialog, clear results, or go home |
| Mic button | Start voice input |
| ← / → (in player) | Seek −10 s / +10 s |
| ↑ / ↓ (in player) | Volume |
| Space / OK (in player) | Play / pause |
| A (in player) | Open the audio-track panel |
| F | Fullscreen |

The top bar is always available with **Home, Hindi, History, Wishlist and Search**, plus a profile switcher and the Settings button. There is no on-screen keyboard: either press **Voice**, or select the Ask box and type with the TV remote's own keyboard.

---

## How the catalog integration works

CircleFTP's modern SPA (`new.circleftp.net`) is JavaScript-driven and not scrapable. This app uses the **server-rendered** site at `hd.circleftp.net`:

| Page | URL pattern |
| --- | --- |
| Genre listing | `/genre/{slug}.html` (24 items/page, paginate via `/genre/{slug}/{offset}.html`) |
| Country listing | `/country/{slug}.html` |
| Search | `/search.html?q={query}` |
| Title detail | `/watch/{slug}.html` |

From a detail page the server extracts title, description, genres, country, release date, duration, quality, IMDb rating, audio labels, related titles, and — critically — the direct stream URL embedded in the page's `sources: [{ src: '...' }]` array.

Results are cached in memory (listings 30 min, details 12 h, home 5 min) so the TV UI stays fast and load on CircleFTP stays gentle. A background warm-up scans ~90 titles on start so the **IMDb Top Rated** and **Hindi audio confirmed** rows fill in within a minute. Opening the **Hindi** page triggers an extra background scan of Indian and TV listings so Hindi movies and series get real depth.

---

## Important: playback and HTTP vs HTTPS

CircleFTP streams are **HTTP-only** (`http://ftpN.circleftp.net/...`). Browsers refuse to load HTTP media inside an HTTPS page (mixed content). The app adapts automatically:

| How you open the app | Play behaviour |
| --- | --- |
| `http://192.168.x.x:8787` (recommended, home network) | **In-app player** with resume, seek, and progress saving. |
| Any `https://` URL (e.g. Vercel) | “Play” opens the title on CircleFTP in a new tab. Posters are routed through `/api/image` so they still load. |

**For the best experience, run the server on a device at home and open its HTTP LAN address on the TV.**

### Codec caveat

Many CircleFTP files are **MKV**. Android TV browsers (and Chrome generally) often cannot decode MKV/AC-3/DTS. If a title fails to play in-app, the player says so honestly and offers **Open on CircleFTP** / **Open direct stream**. Using the TV's native video app via the CircleFTP site usually works better for those files. The player has an **Audio** button: if the TV browser exposes embedded tracks it lets you switch; otherwise it explains that the browser is playing only the default track and offers the native/CircleFTP players. Audio-track switching inside a dual-audio MKV is **not** reliably possible from Chrome-based browsers.

### Tested/typical TV browsers

The UI is built for the browser that ships with Android TV boxes — including **“Browse Here”**, the preinstalled Chromium-based browser on many Android TV devices:

| Capability | On “Browse Here” | What the app does |
| --- | --- | --- |
| D-pad focus navigation | Works | Full spatial navigation with large gold focus rings |
| Voice input | Often missing (no Web Speech API) | Mic button hides; type with the TV remote's keyboard |
| MKV / AC-3 playback | Usually unsupported | Shows an honest message + **Open on CircleFTP** |
| IndexedDB memory | Works | Per-profile likes, history, wishlist persist between launches |
| Fullscreen | Works | Press **F** or use the Fullscreen button |

Voice recognition is configured for **English (en-IN)**. If you prefer Hindi speech, change `lang: 'en-IN'` to `'hi-IN'` in `src/components/AskBar.tsx` and rebuild.

---

## Optional: deploy to Vercel

`vercel.json` and `api/[...path].js` are included, so the repo can be deployed as-is:

```bash
npm i -g vercel
vercel
```

Set `GEMINI_API_KEY` (and optionally `TMDB_API_KEY`, `DEEPSEEK_API_KEY`) in the Vercel dashboard. **Playback will open CircleFTP externally** because of the HTTPS/HTTP limitation above; the AI, search, browsing, memory and posters all work fine.

---

## Project layout

```
home-movie-theatre/
├── server/
│   ├── index.js      # entrypoint, prints LAN TV URL, starts warm-up
│   ├── app.js        # Express routes + static UI + poster proxy
│   ├── catalog.js    # CircleFTP scraper, parsing, caches, home rows
│   ├── ai.js         # Gemini/DeepSeek calls, candidate grounding, local fallback
│   └── tmdb.js       # optional metadata enrichment
├── src/
│   ├── pages/Home.tsx        # main TV screen, Ask bar, AI results, taste rows
│   ├── pages/Hindi.tsx       # Hindi movies + web series
│   ├── pages/History.tsx     # watch history / resume
│   ├── pages/Watchlist.tsx   # saved for later
│   ├── pages/Watch.tsx       # in-app player with resume
│   ├── components/NavBar.tsx # nav + profile switcher
│   ├── components/           # DetailModal, SettingsPanel, AskBar, Row, PosterCard…
│   └── lib/
│       ├── api.ts     # typed API client, streamMode, image proxy helper
│       ├── db.ts      # IndexedDB wrapper (v2, per-profile stores)
│       ├── profiles.ts# Shihab / Olive / Shahnaj aliases + detection
│       ├── memory.tsx # profile-aware preferences / ratings / history / taste
│       ├── nav.ts     # D-pad spatial navigation
│       └── speech.ts  # voice input + text-to-speech
├── api/[...path].js  # Vercel serverless adapter
└── .env.example
```

---

## API reference (all server-side)

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Uptime, catalog base, active AI provider/model, TMDB status, mode. |
| `GET /api/home` | Latest, Korean, family, top-rated, Hindi movies and Hindi series rows. |
| `GET /api/hindi` | Hindi movies and Hindi web series, split by genre. |
| `POST /api/for-you` | `{ taste: { genres, countries }, exclude?: string[] }` → rows re-ranked for the active profile. |
| `GET /api/list?type=genre\|country&slug=…&offset=0` | Paginated listing. |
| `GET /api/search?q=…` | CircleFTP search. |
| `GET /api/detail?slug=…` | Full metadata + stream sources + related. |
| `GET /api/similar?slug=…` | AI recommendations like a given title. |
| `POST /api/ai/recommend` | `{ message, memory, prefs, referenceSlug?, targetName? }` → grounded picks. |
| `GET /api/tmdb?title=…&year=…` | Optional metadata enrichment. |
| `GET /api/image?url=…` | Poster proxy (allow-listed hosts only). |

---

## Privacy

- Your Gemini/DeepSeek key lives only in the server process.
- Memory (likes, history, watchlist, preferences) lives in the TV browser's IndexedDB and never leaves the device — except as a compact taste summary sent with a recommendation request.
- No accounts, no analytics, no tracking.
- Export your memory any time from **Settings → Export memory**; wipe it with **Reset memory**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “The catalog couldn't be reached” | The PC running the server can't reach CircleFTP. Check internet/DNS, or set `CATALOG_BASE`. |
| Badge says “Local picks” | No valid AI key, or the provider call failed. Check `.env`, restart, then open **Settings → System** for the exact status. |
| `Gemini 400: API key not valid` | The key is wrong or was revoked. Create a new one at <https://aistudio.google.com/apikey>. |
| `Gemini 404` | The model ID is retired. Use `gemini-3.5-flash` (the app auto-falls back to `gemini-3.5-flash-lite`). |
| `Gemini 429` | Free-tier quota for today is used up. Wait for the Pacific-time reset or switch `GEMINI_MODEL`. |
| Video shows “could not decode” | The file is probably MKV. Use **Open on CircleFTP** or the TV's native player. |
| Voice button missing | The TV browser has no Web Speech API. Type with the TV remote's keyboard instead. |
| TV can't open the URL | PC firewall blocking port 8787, or devices on different networks. Allow Node.js on private networks. |
| Top Rated row is empty | Warm-up is still scanning; it fills within ~1 minute. Restart to re-trigger. |

---

## Disclaimer

Home Movie Theatre is a personal companion app. It does not host, store, or redistribute any video — playback always streams from CircleFTP's own servers, subject to CircleFTP's access rules. It is not affiliated with CircleFTP, Google, DeepSeek, or TMDB.
#   H o m e - T h e a t r e  
 