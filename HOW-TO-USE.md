# Home Movie Theatre — how to use it every day

## The short version

1. Open the laptop and sign in to Windows as usual.
2. Leave the laptop on (you can close the screen only if Windows is set to **Do nothing** on lid close).
3. On the TV browser, open the bookmark:

   **http://192.168.10.117:8787**

That is it. The server starts by itself at sign-in, so there is nothing to run.

## After switching the laptop off and on again

Windows sometimes re-labels the home Wi-Fi as a **Public** network after a
restart. A firewall rule limited to Private networks then blocks the TV even
though the laptop itself works. That is what happened on 8 Nov 2026, and it is
now fixed permanently: the firewall rule allows port 8787 on **every** network
profile, but only from your own local network.

If it ever happens again, do this once:

1. Open PowerShell **as Administrator** on the laptop.
2. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File "D:\For home tv\home-movie-theatre\scripts\fix-tv-link.ps1"
   ```

It restarts the server if needed, re-opens the firewall on every profile, sets
the Wi-Fi back to Private, and prints the exact TV address.

**Checklist when the TV cannot connect:**

| Check | How |
|---|---|
| Laptop signed in? | Auto-start runs at **sign-in**, not at the lock screen |
| Server awake? | Open `http://localhost:8787` on the laptop |
| Same Wi-Fi? | TV and laptop on the main network, not a guest one |
| Laptop asleep? | Wake it, or set lid-close to **Do nothing** |
| Address changed? | Settings → System → “Open on TV” shows the current one |

## If the TV address stops working

The laptop gets its address from the router. If the router hands out a different
address one day, the app shows the current one:

**Open the app on the laptop → Settings (⚙) → System → “Open on TV”.**

Type that address on the TV once and update the bookmark.

Your router also knows the laptop by name, so this address usually keeps working
even when the number changes:

**http://ShahriarShihab.lan:8787**

If the TV accepts it, use that as the bookmark and the changing number will not
matter any more.

To make the number permanent, add a **DHCP reservation** in the router for this
laptop:

| | |
|---|---|
| Laptop name | `SHAHRIARSHIHAB` |
| Wi-Fi MAC | `90-CC-DF-CD-D0-0C` |
| Wanted address | `192.168.10.117` |

(Router → LAN / DHCP → Address Reservation. The menu name varies by router.)

## Useful shortcuts

| What | Where |
|---|---|
| Start / focus the app on the laptop | Desktop → **Home Movie Theatre** |
| Start it manually | `D:\For home tv\home-movie-theatre\scripts\start-movie-theatre.ps1` |
| Stop it | Task Manager → end the `node.exe` process, or restart Windows |
| Server log | `%TEMP%\hmtheatre.out.log` |
| TV address file | `%TEMP%\hmtheatre.url.txt` |

## When the laptop is off

Use the cloud copy: **https://hometheatre-eight.vercel.app**

Playback there opens CircleFTP (browsers block HTTP video on an HTTPS page). The
home address above gives you the full in-app player.

## Everyday search

The Search page understands four kinds of request:

- **Title** — “Dangal”, “Dangal movie”
- **Actor / director** — “Shah Rukh Khan”, “Amir Khan sports movies”,
  “Nolan movies”
- **Genre** — “Korean thriller”, “Hindi comedy”, “sports movies”
- **Mixed** — “Shah Rukh Khan romantic movies”

Actor results are verified against the person’s filmography and then matched to
titles that really exist in the CircleFTP catalog. The AI is not allowed to add
titles outside that list.

## If something is wrong

- **TV cannot connect** — make sure the TV and laptop are on the same Wi-Fi, and
  that the laptop is awake (not asleep). Then run the repair script above.
- **Server did not start** — run the desktop shortcut once. If it still fails,
  open `%TEMP%\hmtheatre.err.log`.
- **Windows Firewall** — the installer added an inbound rule for TCP port 8787.
  It now covers Public, Private and Domain, restricted to the local network. If
  you use a third-party firewall, allow `node.exe` on the private network.
- **The laptop must be logged in.** Auto-start runs at sign-in, not at the
  lock screen. If you shut down instead of sleeping, the app is unavailable
  until the next sign-in.
- **Wi-Fi says “Public”** — Windows then blocks incoming TV connections. The
  repair script switches it back to Private.
