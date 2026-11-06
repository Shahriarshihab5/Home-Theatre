# Home Movie Theatre

A personal, voice-first movie companion for your TV, built around **your CircleFTP catalog**, with **Google Gemini (free tier)** as the recommendation brain. DeepSeek is supported as an optional alternative.

Every title the AI mentions is verified to exist in the catalog. The model is never allowed to invent a movie, a rating, or an availability claim.

---

## What it does

| Feature | Details |
| --- | --- |
| **Ask for anything** | "Korean thriller in Hindi", "something like Breaking Bad", "family movie under 2 hours". |
| **Grounded recommendations** | The model only sees titles scraped from CircleFTP; every returned slug is re-validated before display. |
| **10-15 high-quality picks** | Picks are ranked by real IMDb ratings learned from CircleFTP detail pages, not guessed. Weak titles are dropped when better ones exist. |
| **Continuous voice feedback** | After results appear, keep talking or typing: "no brother I don't like these, update a bit". The AI remembers the thread, changes direction, and never repeats a title. |
| **Welcome greeting** | Time-of-day greeting (Good morning/afternoon/evening/night) plus a random playful Banglish line, e.g. "Aj ke amra ki movie dekhbo?" or "Cholo aj notun kichu explore kora jak." Tap the line or the speaker to hear it. |
| **Household profiles** | Separate memory for **Shihab**, **Olive** and **Shahnaj**, plus an **All** profile that combines everyone's taste. Say "for Olive", "for my mother" or "something we can all watch". |
| **Personalised rows** | Every row is re-ranked from this profile's likes, watch history and past AI requests. |
| **Persistent memory** | Likes, dislikes, watch history, resume points, wishlist and taste profile - stored in IndexedDB on the TV browser. |
| **Continue Watching** | Progress is saved every ~5 s while playing and resumes where you left off. |
| **History & Wishlist** | Dedicated pages for everything watched/started and everything saved for later. |
| **Hindi sections** | Hindi Movies and Hindi Web Series, confirmed from the stream filename. |
| **Remote-first UI + nav bar** | Home, Hindi, History, Wishlist, Search and profiles, with D-pad spatial navigation and large gold focus rings. |
| **Voice + remote typing** | Web Speech API where available (English). No on-screen keyboard - press **Voice**, or use the TV remote's own keyboard. |
| **Bengali + female voice** | In Settings -> Assistant voice, choose **English** or **বাংলা Bangla**, and a **Female** or **Male** voice. The AI writes a matching short Bengali summary (`replyBn`) for text-to-speech, while the on-screen text stays English. A **Test voice** button previews it. Bengali speech needs a Bengali TTS voice on the TV (Android TV: Settings -> System -> Languages -> Text-to-speech). |
| **Honest metadata** | Audio languages come from the real stream filename and from ffmpeg's track probe. When unknown, the UI says so. |
| **Working audio + track switching** | The server remuxes with ffmpeg: video is copied untouched, the chosen audio track is converted to AAC. Hindi <-> Korean switching works in Chrome, with the position preserved. |
| **Full-length timeline** | The remuxed stream has no seekable index, so the app draws its own timeline from the real duration (e.g. 1:59:19). Tap or drag it to jump to any point - 30 or 50 minutes in - and ffmpeg restarts there, usually in 1-2 seconds. Includes -10 min / +10 min and 25/50/75% jumps. |
| **Playback performance mode** | Blur/fixed-background effects are disabled and animations paused while video plays. |
| **Interface sounds** | Soft D-pad ticks, a selection pop and a chime when new picks arrive. Can be turned off in Settings. |
| **Export / reset** | Download your full profile memory as JSON, or wipe it in two taps. |

---

## Two ways to use it

| Setup | What works | When to use |
| --- | --- | --- |
| **Home server** (`http://<laptop-ip>:8787`) | Everything: live catalog, AI, posters, in-app playback, audio switching, resume. | Laptop/PC on, TV on the same Wi-Fi. Best experience. |
| **Vercel** (`https://hometheatre-eight.vercel.app`) | Browsing, search, ratings, AI recommendations, profiles, memory, bundled posters. Playback opens CircleFTP in a new tab. | Laptop closed, or watching from another device. |

CircleFTP is only reachable from your home network, so a cloud host cannot scrape it live. The Vercel build therefore ships a **catalog snapshot** (`server/data/catalog-snapshot.json`) and **small posters** (`public/posters/`) generated from the last crawl. That is why the Vercel link keeps working after the laptop is shut.

> The catalog is movie-heavy: CircleFTP has no real TV-series section (its `/genre/tv-series` page has zero titles). The AI says so honestly and recommends the closest movies from the same country/genre instead of padding the list with unrelated titles.

---

## Requirements

- **Node.js 18+** (tested on Node 22)
- Internet access to `hd.circleftp.net` (the server scrapes the catalog)
- A **free** Gemini API key: <https://aistudio.google.com/apikey>
- Optional: a free TMDB key for extra metadata, or a DeepSeek key as an alternative provider

---

## Quick start (home server)

```bash
cd home-movie-theatre
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

Add your Gemini key to `.env`:

```ini
GEMINI_API_KEY=your-free-key-here
```

Then:

```bash
npm run build     # build the TV UI once
npm start         # start the server
```

The console prints:

```
Local:   http://localhost:8787
TV:      http://192.168.x.x:8787   <- open this on your TV browser
```

Open the **TV** URL on your Android TV (or phone/PC) and bookmark it. Both devices must be on the same Wi-Fi.

### Development mode

```bash
npm run dev
```

Runs the API on `:8787` and Vite with hot reload on `:5173` (proxying `/api`).

---

## Deploying to Vercel

`vercel.json` and `api/[...path].js` are included, so the repo deploys as-is. Set `GEMINI_API_KEY` in the Vercel dashboard (Project -> Settings -> Environment Variables), then redeploy.

The deployment serves the UI and **snapshot mode** automatically:

- `server/data/catalog-snapshot.json` - learned titles + real IMDb ratings, genres, country, audio labels.
- `public/posters/*.jpg` - 150px posters, served over HTTPS so the TV grid stays visual.
- `/api/home`, `/api/list`, `/api/search`, `/api/detail` and `/api/ai/recommend` all answer instantly from the snapshot.

When the catalog changes on your home network, refresh both files and push:

```bash
npm start            # let the crawl learn titles (runs in the background)
npm run snapshot     # rebuild server/data/catalog-snapshot.json
npm run posters      # download/compress new posters (existing ones are skipped)
git add server/data public/posters
git commit -m "refresh catalog snapshot"
git push             # Vercel redeploys automatically
```

Extra options:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CATALOG_MODE` | `snapshot` on Vercel, `live` locally | `live` forces live scraping, `snapshot` forces saved data. |
| `CATALOG_BASE` | `http://hd.circleftp.net` | Use a tunnel URL if you ever expose the catalog. |

---

## Configuration (`.env`)

### AI - Gemini (default, free tier)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | - | **Required for AI.** Server-side only; never sent to the browser. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Best free balance of speed and quality. |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Used automatically on 503/429. |
| `GEMINI_THINKING_LEVEL` | `low` | `low` / `minimal` / `high`. Lower is faster - better for TV. |

### AI - provider selection & optional DeepSeek

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `auto` | `auto` (Gemini, then DeepSeek), `gemini`, `deepseek`, or `local`. |
| `DEEPSEEK_API_KEY` | - | Optional alternative provider. |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Served by DeepSeek-V4.1-Flash. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible endpoint. |

If no AI key is configured, the app still works: a local recommender ranks the same verified catalog by taste, ratings and request relevance.

### Catalog, quality index & player

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Server port. |
| `CATALOG_BASE` | `http://hd.circleftp.net` | Catalog source. |
| `DETAIL_TTL_MINUTES` | `720` | How long a detail page stays cached in memory. |
| `CRAWL_ENABLED` | `1` | Set `0` to skip the background rating crawl. |
| `CRAWL_MAX` | `4000` | Maximum titles to learn per crawl. |
| `RATING_BUDGET` | `36` local / `10` Vercel | Detail pages fetched per AI request to fill ratings. |
| `PLAYER_TRANSCODE` | on | Set `0` to disable the ffmpeg remux (no audio switching). |
| `TMDB_API_KEY` | - | Optional poster/rating enrichment. |

---

## How quality ranking works

1. Every detail page the app ever fetches teaches it the real IMDb rating, genres, country and audio label for that title.
2. Those facts persist in `data/catalog-index.json` (gitignored) and survive restarts.
3. A gentle background crawl walks genres, countries and year pages, learning ratings for the catalog at roughly 2,200 titles per pass.
4. Recommendation candidates are merged from live listings, search, free-text matches and the learned index.
5. The model sees `[IMDb 7.4]`, `[audio: Hindi + English · Dual audio]` and `[web series]` markers, and is told to prefer 7+, drop anything below 5.5 when enough strong titles remain, and never leave the requested country/genre just to fill slots.
6. The local fallback uses the same ratings, so it is also quality-first when Gemini is unavailable.

Typical learned coverage after one crawl: ~2,240 titles, ~2,230 rated, 146 at 8.0+, 347 at 7.5+, 624 at 7.0+.

---

## Household profiles

| You say | The AI uses |
| --- | --- |
| "What should I watch?" | The currently selected profile. |
| "Something for Olive", "for my brother" | Olive's memory. |
| "Recommend for my mother", "for Shahnaj" | Shahnaj's memory. |
| "For Shihab" / "for me" | Shihab's memory. |
| "Watch together", "for everyone", "all of us" | The **All** profile - combined taste, likes, history and wishlist. |

In **All** mode, likes, saves and viewing progress are written to every person's profile, so a family session teaches everyone. Use **Add** next to the profiles to create more people.

---

## Using it with the TV remote

| Key | Action |
| --- | --- |
| Arrow buttons | Move focus between nav buttons, posters, chips and buttons |
| OK / Enter | Select the focused item |
| Back / Escape | Close a dialog, clear results, or go home |
| Mic button | Start voice input |
| Left/Right (player) | Seek -10 s / +10 s |
| Timeline (player) | Tap/drag anywhere, or focus it and press Left/Right, to jump through the whole movie |
| -10 min / +10 min (player) | Big jumps without dragging |
| Up/Down (player) | Volume |
| Space / OK (player) | Play / pause |
| A (player) | Open the audio-track panel |
| F | Fullscreen |

The top bar always has **Home, Hindi, History, Wishlist and Search**, plus profiles and Settings. There is no on-screen keyboard: press **Voice**, or select the Ask box and use the TV remote's keyboard.

---

## How the catalog integration works

CircleFTP's modern SPA (`new.circleftp.net`) is JavaScript-driven and not scrapable. This app uses the server-rendered site at `hd.circleftp.net`:

| Page | URL pattern |
| --- | --- |
| Genre listing | `/genre/{slug}.html` (24 per page, paginate via `/genre/{slug}/{offset}.html`) |
| Country listing | `/country/{slug}.html` |
| Year listing | `/year/{year}.html` |
| Search | `/search.html?q={query}` |
| Title detail | `/watch/{slug}.html` |
| Stream | `http://ftpN.circleftp.net/FILE/...` from the detail page's `sources: [{ src }]` |

From a detail page the server extracts title, description, genres, country, release date, duration, quality, IMDb rating, audio labels, related titles, and the direct stream URL. Listings cache for 30 min, details for 12 h, and home rows for 5 min.

---

## Playback and HTTP vs HTTPS

CircleFTP streams are **HTTP-only**. Browsers refuse to load HTTP media inside an HTTPS page (mixed content). The app adapts:

| How you open the app | Play behaviour |
| --- | --- |
| `http://192.168.x.x:8787` | In-app player with resume, seek, progress saving and real audio switching. |
| Any `https://` URL (Vercel) | Watch page explains that playback needs the home network and opens the title on CircleFTP. Browsing and AI still work. |

### Why the audio used to be silent

Many titles are MKV with **E-AC3/DTS** audio, which Chrome cannot decode - the picture plays with no sound. The server now probes the file with ffmpeg and streams a remuxed fMP4:

- video is **copied untouched** (no quality loss, low CPU);
- the selected track is converted to **AAC stereo**;
- the real track list (`Hindi`, `Korean`, ...) is shown in the player;
- switching tracks restarts the stream at the current position.

This needs `ffmpeg-static` (installed by `npm install`) and is disabled automatically on Vercel or with `PLAYER_TRANSCODE=0`.

### Tested/typical TV browsers

| Capability | On "Browse Here" (Android TV) | What the app does |
| --- | --- | --- |
| D-pad focus navigation | Works | Full spatial navigation with large gold focus rings |
| Voice input | Often missing | Mic button hides; type with the TV remote's keyboard |
| MKV / AC-3 playback | Usually unsupported | ffmpeg remux serves MP4/AAC over HTTP on the home server |
| IndexedDB memory | Works | Per-profile likes, history, wishlist persist between launches |
| Fullscreen | Works | Press **F** or use the Fullscreen button |

Voice recognition is configured for **English (en-IN)**. Change `lang: 'en-IN'` in `src/components/AskBar.tsx` and rebuild for Hindi.

---

## Project layout

```
home-movie-theatre/
  server/
    index.js      # entrypoint, prints LAN TV URL, starts crawl
    app.js        # Express routes + static UI + image proxy
    catalog.js    # scraper, parsers, caches, quality index, snapshot mode
    ai.js         # Gemini/DeepSeek calls, grounding, ranking, local fallback
    player.js     # ffmpeg probe + fMP4 remux streaming
    data/
      catalog-snapshot.json  # committed catalog for cloud hosting
  scripts/
    make-snapshot.mjs        # rebuild server/data/catalog-snapshot.json
    make-posters.mjs         # build public/posters/*.jpg
  src/
    pages/Home.tsx           # greeting, Ask bar, conversation, AI results
    pages/Watch.tsx          # player, audio tracks, resume, silence detection
    pages/Hindi.tsx          # Hindi movies + web series
    pages/History.tsx        # watch history / resume
    pages/Watchlist.tsx      # saved for later
    components/              # NavBar, DetailModal, SettingsPanel, Row, PosterCard...
    lib/
      api.ts                 # typed client, VITE_API_BASE, playUrl, imgSrc
      db.ts                  # IndexedDB wrapper (v2, per-profile stores)
      profiles.ts            # Shihab / Olive / Shahnaj aliases + detection
      memory.tsx             # profile-aware preferences / history / taste
      nav.ts                 # D-pad spatial navigation
      speech.ts              # voice input + text-to-speech
  api/[...path].js           # Vercel serverless adapter
```

---

## API reference (server-side)

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Uptime, catalog base, AI provider/model, index stats, player status, mode. |
| `GET /api/home` | Latest, Korean, family, top-rated, Hindi movies and series rows. |
| `GET /api/hindi` | Hindi movies and web series. |
| `POST /api/for-you` | `{ taste: { genres, countries }, exclude?: string[] }` - rows re-ranked for a profile. |
| `GET /api/list?type=genre\|country&slug=...&offset=0` | Paginated listing. |
| `GET /api/search?q=...` | Catalog search. |
| `GET /api/detail?slug=...` | Metadata, stream sources, related titles. |
| `GET /api/stream-info?slug=...` | ffmpeg probe: real audio/subtitle tracks and codecs. |
| `GET /api/play?slug=...&a=<track>&t=<seconds>` | Remuxed MP4 stream (video copy, AAC audio). |
| `GET /api/similar?slug=...` | Recommendations like a given title. |
| `POST /api/recommend` | `{ message, memory, prefs, targetName?, avoidSlugs?, history?, topic? }` - grounded picks. `/api/ai/recommend` is kept as an alias. |
| `GET /api/tmdb?title=...&year=...` | Optional metadata enrichment. |
| `GET /api/image?url=...` | Poster proxy for allow-listed hosts (used when no bundled poster exists). |

---

## Privacy

- Your Gemini/DeepSeek key lives only in the server process.
- Memory lives in the TV browser's IndexedDB and never leaves the device, except as a compact taste summary sent with a recommendation request.
- No accounts, no analytics, no tracking.
- Export or reset memory any time from **Settings**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The catalog couldn't be reached" | The server can't reach CircleFTP. Check internet/DNS, or set `CATALOG_BASE`. |
| Vercel shows titles but Play says it needs home Wi-Fi | Expected: cloud hosts cannot reach CircleFTP or serve its HTTP streams. Use the home server for in-app playback, or let Play open CircleFTP. |
| Vercel shows old titles | Run `npm run snapshot && npm run posters`, commit, push. |
| Posters are initials on Vercel | The poster for that title is not bundled yet; run `npm run posters`. |
| Badge says "Local picks" | No valid AI key, or the provider call failed. Open **Settings -> System**. |
| `Gemini 400: API key not valid` | Create a new key at <https://aistudio.google.com/apikey>. |
| `Gemini 404` | Retired model ID. Use `gemini-3.5-flash`. |
| `Gemini 429` | Free-tier quota used up. Wait for the Pacific-time reset or switch model. |
| Video plays with no sound | Reload with the **Fix sound** button (ffmpeg remux). On Vercel this is not available. |
| Audio switching does nothing | The file has a single track, or `PLAYER_TRANSCODE=0`. |
| Seeking takes a few seconds | Expected: the image is not re-encoded, but ffmpeg must reconnect and jump to the new position. Usually 1-2 seconds. |
| Bangla voice is silent or reads English | The TV has no Bengali text-to-speech voice. Install it in Android TV settings (Settings -> System -> Languages -> Text-to-speech -> Install voice data -> Bengali). Check the count under Settings -> Assistant voice. |
| Voice button missing | The TV browser has no Web Speech API. Type instead. |
| TV can't open the URL | PC firewall blocking 8787, or different networks. Allow Node.js on private networks. |
| Top Rated row is empty | The crawl is still running; it fills within a minute or two. |
| AI says "no web series" | Correct: this catalog has no TV-series section. Ask for movies in the same country/genre. |

---

## Disclaimer

Home Movie Theatre is a personal companion app. It does not host, store, or redistribute any video - playback always streams from CircleFTP's own servers, subject to CircleFTP's access rules. It is not affiliated with CircleFTP, Google, DeepSeek, or TMDB.
