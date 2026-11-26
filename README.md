# Willowbrook - TownSim

A browser-based pixel-art town life simulator where 12 AI-driven characters live autonomously -- working, eating, socializing, forming relationships, falling in love, starting rivalries, and spreading gossip. Powered by any OpenAI-compatible LLM.

![Node.js](https://img.shields.io/badge/Node.js-20+-green)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## What Is This?

Willowbrook is a tiny pixel village that lives on its own. 12 characters with distinct personalities follow daily routines -- baking bread, hammering at the smithy, fishing at the docks -- but the magic happens when an LLM drives their social decisions. Characters chat, flirt, argue, gossip, confess feelings, and storm off. A Drama Engine tracks storylines like love triangles and rivalries, escalating tension until something dramatic happens.

You watch it unfold like a soap opera you can't stop watching.

### Characters

| Name | Job | Personality |
|------|-----|-------------|
| Alice | Baker | Cheerful, hardworking, gossip |
| Bob | Blacksmith | Quiet, hardworking, kind |
| Carol | Herbalist | Kind, cautious, devout |
| Dave | Shopkeeper | Grumpy, practical, gossip |
| Emma | Barmaid | Cheerful, flirtatious, adventurous |
| Frank | Farmer | Hardworking, humble, quiet |
| Grace | Priest | Devout, kind, cautious |
| Henry | Carpenter | Practical, ambitious, grumpy |
| Ivy | Artist | Artistic, adventurous, flirtatious |
| Jack | Guard | Cautious, quiet, practical |
| Kate | Teacher | Kind, hardworking, ambitious |
| Leo | Fisherman | Lazy, cheerful, adventurous |

## Features

**Drama Engine** -- Tracks storylines (love triangles, rivalries, grudges, secret keepers, forbidden friendships) through lifecycle phases. Stories may build toward a climax or fade quietly. Gossip propagates through the social network.

**35 Action Types** -- Beyond basics (eat, sleep, work), characters can confess, comfort, confront, gossip, dance, sing, cry, laugh, celebrate, storm off, craft, fish, garden, explore, stargaze, and more.

**Multi-Dimensional Relationships** -- Four axes (affection, trust, attraction, respect) instead of a flat number. Characters develop crushes, rivalries, and deep bonds over time.

**Token-Optimized LLM** -- Compressed prompt format (~50 tokens per character query), batched decisions (up to 6 per API call), situation caching, and rule-based fallbacks. Runs affordably on free/cheap models.

**Visual** -- A hand-crafted procedural pixel-art world: timber-framed cottages with shaded roofs, glowing windows, and chimney smoke; a cobblestone town square with an animated fountain; a pier and bobbing rowboat on the lake; forests, crops, and flower beds. Smooth day/night color grading with street lamps, firefly-filled nights, drifting cloud shadows, and sparkling water. Characters are animated pixel sprites with hair, outfits, and job hats (guard helmets, straw hats, baker's toques), plus speech bubbles and emoji reactions. Mouse-wheel zoom lets you swoop from a town overview down to a single conversation.

## Quick Start

### Prerequisites

- Node.js 20+
- An OpenAI-compatible LLM endpoint (OpenRouter, Ollama, OpenAI, etc.)

### Run Locally

```bash
git clone https://github.com/YOUR_USERNAME/townsim.git
cd townsim
npm install
cp .env.example .env
# Edit .env with your LLM credentials
npm start
```

Open http://localhost:3000 on the Docker host. Compose binds only to loopback by default. The simulation continues without a browser while the container is running.

### Run with Docker

```bash
cp .env.example .env
# Edit .env with your LLM credentials
docker compose up --build
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LLM_BASE_URL` | OpenAI-compatible API endpoint | `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | Model identifier | `nvidia/nemotron-3-nano-30b-a3b:free` |
| `LLM_API_KEY` | API key (leave empty for local models) | `sk-...` |
| `LLM_API_KEY_FILE` | File containing an API key; takes precedence over `LLM_API_KEY` | `/run/secrets/openrouter_api_key` |
| `LLM_DAILY_LIMIT` | Maximum outgoing AI attempts per UTC day, including retries; 0 disables AI | `0` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `production` |

### LLM Provider Examples

**OpenRouter (free models available):**
```
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
LLM_API_KEY=sk-or-v1-...
```

**Ollama (local, free):**
```
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3
LLM_API_KEY=
```

**OpenAI:**
```
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
```

**No LLM (rule-based fallback):**
Leave `LLM_BASE_URL` empty or set `LLM_DAILY_LIMIT=0` (the default). Characters will still follow schedules, satisfy needs, and have basic social interactions driven by personality and relationship data.

## Controls

| Key | Action |
|-----|--------|
| `Space` | Pause / Resume |
| `1` | Normal speed (1x) |
| `2` | Fast (2x) |
| `3` | Fastest (5x) |
| `C` | Toggle character panel |
| `E` | Toggle event feed |
| `F` | Follow selected character |
| `Tab` | Cycle to next character |
| `Escape` | Deselect / close |
| Click character | Select and view details |
| Drag canvas | Pan the camera |
| `W/A/S/D` | Pan camera |
| Mouse wheel / pinch | Zoom in and out (toward cursor) |
| `+` / `-` | Zoom in and out |

## Architecture

```
townsim/
├── config/
│   ├── default.json          # Tick speed, LLM settings, need decay rates
│   ├── town.json             # Town map: 60x40 grid, 24 buildings
│   └── characters.json       # 12 characters with personalities
├── server/
│   ├── index.js              # Express + WebSocket entry point
│   ├── simulation/
│   │   ├── engine.js         # Core simulation loop (50s at 1×)
│   │   ├── world.js          # World state, grid, buildings
│   │   ├── character.js      # Character class with needs, mood, memory
│   │   ├── actions.js        # 35 action types + execution
│   │   ├── needs.js          # Need decay + critical thresholds
│   │   ├── pathfinding.js    # A* on tile grid
│   │   ├── scheduler.js      # Decision point gating
│   │   ├── interactions.js   # 4D relationship updates
│   │   └── dramaEngine.js    # Storyline tracking, gossip, tension
│   ├── llm/
│   │   ├── client.js         # OpenAI-compatible HTTP client
│   │   ├── promptBuilder.js  # Compressed prompt construction
│   │   ├── responseParser.js # Parse LLM responses into actions
│   │   ├── batcher.js        # Batch decisions + fallback AI
│   │   └── cache.js          # Situation caching
│   ├── api/
│   │   ├── routes.js         # REST API endpoints
│   │   └── websocket.js      # Real-time state push
│   └── persistence/
│       └── stateManager.js   # Atomic save/load to JSON
├── public/
│   ├── index.html            # Game UI layout
│   ├── css/style.css         # Storybook Village theme
│   └── js/
│       ├── main.js           # App init + game loop
│       ├── renderer.js       # Dual-canvas pixel art rendering
│       ├── camera.js         # Viewport with smooth scrolling
│       ├── ui.js             # Panels, roster, detail cards
│       ├── notifications.js  # Toast alerts + event classification
│       ├── input.js          # Mouse, keyboard, touch
│       └── interpolation.js  # Smooth character movement
├── Dockerfile
├── docker-compose.yml
└── data/                     # Persisted state (gitignored)
```

## How It Works

### Tick Cycle (every 50 seconds at 1×)

1. Advance the authoritative world clock continuously (one in-game minute every five seconds at 1×); the main simulation updates every ten in-game minutes
2. Decay character needs (hunger, energy, social, fun, hygiene)
3. Execute current actions (walk, eat, work, chat, etc.)
4. Check critical needs -- auto-eat if starving, auto-sleep if exhausted
5. Fire schedule-driven actions (go to work, lunch break, go home)
6. Update Drama Engine (storylines, tension, gossip)
7. Detect decision points -- which characters need LLM guidance?
8. Batch LLM call with compressed prompts
9. Parse responses into actions, speech, thoughts, emotions
10. Update relationships from social interactions
11. Auto-save state
12. Push state diff to all connected browsers via WebSocket

### Token Optimization

The LLM integration uses a 4-layer strategy to minimize API costs:

1. **Avoid calls** (~60% eliminated) -- Rule-based need satisfaction and schedule-driven routines don't need LLM
2. **Batch decisions** (~3-4x reduction) -- Up to 6 character decisions per API call
3. **Compressed encoding** (~50 tokens per query) -- Abbreviated traits, single-letter need codes, compact relationship info
4. **Situation caching** (~10-20% additional) -- Same situation within 50 ticks reuses cached decision

Prompt format:
```
[Q1]alice,baker,chf.hw.gsp|h3e7s5f4|bakery|near:bob(fr6)|mr|mood:happy|drama:crush_on_bob
[A1]ACT:chat,bob|SAY:Morning Bob!|THINK:He looks nice today|EMO:happy
```

### Drama pacing and quick simulation

The `drama` section of `config/default.json` controls significant events without affecting routine actions:

| Setting | Default | Meaning |
|---------|---------|---------|
| `eventChance` | `0.12` | Overall probability multiplier for an eligible major opportunity. |
| `conflictFrequency` | `0.4` | Multiplier for conflict and rivalry opportunities. |
| `romanceFrequency` | `0.5` | Multiplier for romantic opportunities. |
| `cooldownHours` | `18` | Minimum simulated hours before a character can participate in another major development. |

The first three values range from 0 to 1 and are multiplied together as appropriate; personality can adjust the result. They are probabilities per eligible opportunity, not guaranteed events per day. The cooldown uses the in-game clock, survives saves, and scales naturally with the speed controls. Existing saves without cooldown data remain compatible. Ordinary conversation, work, and needs continue with AI disabled.

To inspect pacing without waiting for real-time days, run this from the project root:

```bash
node scripts/drama-sim.js . 14 10 normal
node scripts/drama-sim.js . 14 10 social
```

These commands simulate 14 days for each of 10 fixed seeds without reading or writing your saved world or contacting an LLM. `normal` uses the starting town; `social` starts with established attraction and friction to exercise eligible opportunities. The output counts flirt, confess, argue and confront interactions, new storylines, climaxes, and days without those events. It is a repeatable diagnostic rather than a prediction for every saved town.

`simulationErrors` reports caught decision-processing errors. In the reference fresh-town run, two came from an existing pathfinding edge case even though no LLM was enabled; the affected decisions fell back to idle. Movement code is unchanged by the drama-pacing feature.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full world state |
| GET | `/api/characters` | All character summaries |
| GET | `/api/character/:id` | Single character detail |
| GET | `/api/log` | Activity log |
| GET | `/api/config` | Server config (API key masked) |
| GET | `/api/stats` | Uptime, LLM usage, drama state |
| GET | `/api/drama` | Drama engine state |
| POST | `/api/speed` | Set simulation speed `{ speed: 1-5 }` |
| POST | `/api/pause` | Toggle pause |

## Raspberry Pi deployment with GHCR

The Pi only needs Docker, Docker Compose, the deployment Compose file, and optional settings; it does not need the repository or Node.js. The workflow in `.github/workflows/publish-image.yml` tests the code and publishes a `linux/arm64` image to `ghcr.io/<owner>/<repository>` on pushes to `main`. It also supports manual runs on `main`. Each successful run publishes `latest` and `sha-<full-commit-sha>` tags. It does not contact or update the Pi. Changes on `dev` do not publish an image until they are deliberately promoted to `main`.

### First deployment

1. On GitHub, make sure the workflow has run successfully on `main` and note the package's visibility. The first image is not available until that happens. The package owner must allow the repository's Actions workflow to write packages.
2. On the Pi, create a directory for deployment configuration. Copy only `docker-compose.ghcr.yml` into it from GitHub (download it through GitHub or transfer it from another machine). No repository checkout is needed:

   ```bash
   mkdir -p ~/willowbrook
   cd ~/willowbrook
   # Place docker-compose.ghcr.yml in this directory.
   ```

3. If the GHCR package is private, authenticate once on the Pi with `docker login ghcr.io -u YOUR_GITHUB_USERNAME` and enter a GitHub personal access token when prompted. A classic token needs `read:packages`, and its account must have access to the package; organization SSO authorization may also be required. Do not put the token in the Compose file, `.env`, or shell command history. Public packages do not require login.
4. The container listens on port 3000, and the stable named volume is `willowbrook-data`. The default host binding is loopback only. Create or edit `.env` in this directory to select your image; the other settings are optional:

   ```dotenv
   WILLOWBROOK_IMAGE=ghcr.io/sameplaceapp/townsim:latest
   WILLOWBROOK_BIND_ADDRESS=<private-ip-of-pi>
   WILLOWBROOK_VOLUME_NAME=<existing-volume-name>
   OPENROUTER_SECRET_FILE=/home/<pi-user>/.config/willowbrook/openrouter_api_key
   ```

   Replace the example image with your own lowercase GHCR owner and repository if using another fork. Replace the other placeholders with real values, or omit the optional bind address and volume lines. `OPENROUTER_SECRET_FILE` is required and must be an absolute path outside the repository; create the file as described below before starting Compose. To discover the Pi's addresses, run `hostname -I` and select its private LAN address. This is deployment configuration, not a hard-coded address in the app. Keep the app on a trusted LAN; do not bind it to a public interface or add public router forwarding. The app has no login.
5. **If you already have a world**, find the actual volume mounted at `/app/data` before starting the new Compose setup. For example, identify the existing container with `docker ps -a`, then run:

   ```bash
   docker inspect <existing-container> --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
   ```

   Set `WILLOWBROOK_VOLUME_NAME` to the volume name shown beside `/app/data` in `.env`. A new directory or Compose project can otherwise select a different volume and appear to start a fresh world. Back up the existing volume first. Never remove or overwrite it to test a migration.
6. Create the protected secret file and configure OpenRouter as described below, then pull the finished image and start it:

   ```bash
   docker compose -f docker-compose.ghcr.yml pull
   docker compose -f docker-compose.ghcr.yml up -d --no-build
   ```

   Open the Pi's configured address on port 3000, and check `docker compose -f docker-compose.ghcr.yml logs --tail=50` if needed. Compose restarts the container unless it was explicitly stopped. The named volume holds `/app/data/state.json`, its backup, and the AI request counter across container replacement.

### OpenRouter secret on the Pi

Keep the key on the Pi, outside the repository and image. On the Pi, create a private directory and enter the key at the hidden prompt (this replaces that secret file if it already exists):

```bash
install -d -m 700 "$HOME/.config/willowbrook"
read -r -s -p 'OpenRouter API key: ' willowbrook_key; printf '\n'
(umask 077; printf '%s\n' "$willowbrook_key" > "$HOME/.config/willowbrook/openrouter_api_key")
unset willowbrook_key
chmod 600 "$HOME/.config/willowbrook/openrouter_api_key"
```

Set `OPENROUTER_SECRET_FILE` in the deployment `.env` to the **absolute** path printed by `printf '%s\n' "$HOME/.config/willowbrook/openrouter_api_key"`. Add these non-secret settings, choosing an available OpenRouter model and your desired limit:

```dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
LLM_DAILY_LIMIT=20
```

`LLM_DAILY_LIMIT=0` disables AI requests; a positive limit is required. The limit counts attempts, including retries, per UTC day. OpenRouter usage may incur charges depending on the model and account. The GHCR Compose file mounts the secret at `/run/secrets/openrouter_api_key`; it does not pass the key value in an environment variable. Compose file-backed secrets use host file permissions, so the container process must be able to read the file. A missing or unreadable configured secret causes startup to fail clearly. Restart the container to load a changed key.

To run without any AI provider, create the required secret file empty (only if it does not already exist) and keep `LLM_DAILY_LIMIT=0` and `LLM_BASE_URL` unset:

```bash
install -d -m 700 "$HOME/.config/willowbrook"
if [ ! -e "$HOME/.config/willowbrook/openrouter_api_key" ]; then
  (umask 077; : > "$HOME/.config/willowbrook/openrouter_api_key")
fi
```

Set `OPENROUTER_SECRET_FILE` to its absolute path in `.env` as above. An empty key file is supported for this rule-based mode.

After the change is released on `main` and its GHCR build succeeds, replace the Pi's deployment Compose file with the new version, then run the pull and `up -d --no-build` commands above from the deployment directory. This recreates the container while keeping the configured world-data volume. If GHCR is private, authenticate as described above before pulling.

To check connectivity, open `http://<pi-address>:3000/api/stats` from a device that can reach the app. With a configured provider and positive limit, `aiBudget.enabled` is true; `aiBudget.used` counts attempts and `llmCalls` counts successful responses since startup. The game only requests AI for eligible encounters, so a successful response may take time. If attempts increase but `llmCalls` remains zero, check the container logs for provider errors and `aiBudget.fallbackReason` for cooldown or budget exhaustion. Do not paste your key into logs or support requests.

### Update and rollback

The Pi updates only when you run these commands. Before an update, record the currently running image's digest and back up the volume. To find the digest of the running container's image:

```bash
docker image inspect "$(docker inspect "$(docker compose -f docker-compose.ghcr.yml ps -q townsim)" --format '{{.Image}}')" --format '{{json .RepoDigests}}'
```

Save the `ghcr.io/...@sha256:...` value for rollback. If the list is empty, record the image's digest from its GHCR package page instead. In the deployment directory, with `WILLOWBROOK_IMAGE` set to the desired image in `.env`:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d --no-build
```

For rollback, set `WILLOWBROOK_IMAGE` in `.env` to a previously published full commit tag, `ghcr.io/<owner>/<repository>:sha-<full-commit-sha>`, or a previously recorded `ghcr.io/<owner>/<repository>@sha256:<manifest-digest>`, then run the same two commands. Commit tags identify workflow runs but can be moved if an image is rebuilt; a recorded manifest digest identifies the exact image. GHCR must still retain that tag or digest. An older application may not understand data written by a newer version: preserve a separate backup before changing versions and do not overwrite the existing volume to test a rollback.

To reclaim disk space, `docker image prune` removes dangling images after confirmation and does not remove volumes. It may remove a locally cached untagged image useful for rollback, so retain the desired rollback tag or digest in GHCR. To remove a specific old image, inspect `docker image ls` and use `docker image rm <image-reference>` only after confirming it is not needed. Avoid `docker compose down -v`, volume pruning, and `docker system prune --volumes`: those can delete world data.

## License

MIT

### World saves and AI budget

World state and the AI request counter are stored in `data/` (or the Docker volume). Snapshots are written atomically with a previous backup; if both are unreadable, startup stops rather than replacing the world. Back up this data before upgrading. AI calls run in the background, use a UTC daily attempt limit, and are disabled by default. Configure `LLM_BASE_URL`, `LLM_MODEL`, a key if required, and a positive `LLM_DAILY_LIMIT` to enable them. For GHCR deployments, use the secret file instructions above; for local development, `LLM_API_KEY` is supported when `LLM_API_KEY_FILE` is unset. The simulation uses rule-based decisions immediately; recent AI results are reused only if the situation matches. After a provider failure, requests pause for one minute. Usage and fallback status are visible in `/api/stats`.

### World history foundation

`GET /api/history` returns recorded historical events in chronological order. Optional query parameters are `type`, `entity` (a stable character or other entity ID), `kind` (such as `character`, used with `entity`), `limit` (1–100, default 50), and `offset` (default 0). `nextOffset` supplies the next page. Events with the same in-game minute retain their recording order. History is not sent with browser state or activity updates.

Existing activity and drama entries are **not** retroactively converted into history; automatic recording applies only to new qualifying transitions described below. Future systems should call `engine.history.record({ id, type, description, entities, metadata })` at the actual event. Supply a stable, unique occurrence ID (for example `storyline:42:resolved`); retrying identical data returns the original record, while reusing that ID for a different event fails. The simulation clock supplies the timestamp. Entities use `{ kind, id }`, not display names. Supported types are listed in `server/history/worldHistory.js` and can be extended there.

History is part of `data/state.json` and the existing `state.json.bak`, with the same graceful shutdown and recovery behavior as world state. Older saves without history load with an empty history. The current `dev` branch does not include a browser backup/export feature; copy the entire saved world when making a backup. As with other world state, changes since the last save can be lost after an abrupt crash. The JSON snapshot grows with history and is fully read on startup and rewritten on each save; queries scan the stored records, although their responses are limited. This is suitable for a modest number of significant events, not high-volume activity logging. Monitor save size and latency as the world grows; no history is automatically deleted.

To verify without modifying a real world, use an isolated fixture in two separate application processes:

```bash
node scripts/history-demo.js create /tmp/willowbrook-history-check.json
node scripts/history-demo.js inspect /tmp/willowbrook-history-check.json
```

The output should show the same `demo:community:1` ID and simulation time in both runs. Choose a new absolute path if the fixture already exists; the command refuses to overwrite one. To verify through an isolated headless server, run:

```bash
node scripts/history-demo.js serve /tmp/willowbrook-history-check.json
```

Open `http://127.0.0.1:3017/api/history` on that machine, note the event ID and time, stop the server with Ctrl+C, and run the same `serve` command again. Refresh the endpoint and check that both values match. This fixture server binds to localhost and never loads or overwrites the real world. For an actual running world, visit `/api/history?limit=10` on its normal private app address. This read-only endpoint has no separate authentication, just like the other existing app APIs.

### Automatic historical milestones

Accepted interactions can now record an established friendship (both weighted relationship levels reach 7 after at least three interactions), significant mutual deterioration (both fall to 3 or below), or recovery after significant strain (both reach 4.5). Friendship must fall below 6.5, or strain rise above 3.5, before that milestone can be recorded again. This hysteresis state is saved with the world. Existing relationships are used as the starting baseline; they are not retroactively recorded. Only the state actually applied by the simulation is considered, including accepted rule-based and AI-assisted actions; dialogue alone is not a historical event.

The start, climax, and conclusion of a rivalry or grudge storyline are recorded when those transitions occur. A conclusion means the existing storyline ended; it does not claim the characters reconciled. Ordinary chat and the temporary `/api/log` activity feed are not automatically saved as permanent history. The `/api/history` endpoint returns permanent milestones. Occupations are assigned at character creation, with no existing occupation-change mechanism to record. Older saves and the existing world snapshot backup continue to work; the browser backup/export feature is not present on this branch.

To see a controlled existing interaction produce history without changing a real world, run in a development checkout:

```bash
node scripts/history-integration-demo.js /tmp/willowbrook-integration-check.json
node scripts/history-demo.js serve /tmp/willowbrook-integration-check.json
```

The fixture path must not already exist. Open `http://127.0.0.1:3017/api/history` on that machine, note the friendship record's ID and time, stop the fixture server with Ctrl+C, and run the same `serve` command again. The record should be unchanged. The scenario uses a test world, applies the existing relationship interaction logic, and does not call an LLM.

### Browsing the History timeline

Open **History** in the top bar for the newest permanent events. Apply category, resident ID or name, and optional day filters; **Load older events** keeps those filters, and **Refresh** checks for newer records. Select an event for its details, then select an active resident to open their profile and center the map. Historical residents who are no longer active remain visible by ID. Activity in `/api/log` is temporary and separate from the permanent archive.

To test in Chromium without changing your real world, use a new absolute fixture path:

```bash
npm ci
node scripts/history-timeline-demo.js create /tmp/willowbrook-timeline-check.json
node scripts/history-timeline-demo.js serve /tmp/willowbrook-timeline-check.json
```

Open `http://127.0.0.1:3017`, select **History**, apply the Conflict category and resident `alice`, and use **Load older events**. Clear filters, select an entry, inspect its details, and select an active resident to locate them. Entries involving `former_resident` demonstrate an unavailable historical reference. Stop the fixture server with Ctrl+C and run the same `serve` command again; the records should remain. The fixture has 80 representative test events, binds only to localhost, and refuses to overwrite an existing file. A production world may have no events until significant developments occur.

For reverse chronological API pages use `order=desc&limit=25`, then send `before=<nextBefore>` from each response. A cursor preserves your place if new records arrive; refresh from the first page to see them. `fromDay` and `toDay` filter by inclusive simulation day on the server. The existing ascending `offset` API remains available. Filtering scans history on the server, so very large archives may increase query time; records are not copied into regular simulation updates.

### While you were away

On returning to the same world in the same browser, Willowbrook uses the last observed historical event ID and simulation time to prepare a short, deterministic report. It includes only saved historical records, never asks an LLM to write a summary, and reports elapsed **simulation** time rather than wall-clock downtime. Population changes are omitted because current history does not reliably track them. If no events were recorded during a simulated absence, the report says so. A first visit establishes a baseline without claiming an absence.

The marker is stored in that browser's local storage, so another browser or cleared site data starts a new baseline. A saved world has its own ID; switching worlds or restoring a save that no longer contains the marker resets the baseline rather than mixing histories. Old saves receive an ID on startup, which is preserved with the next world save. As with other changes, an abrupt crash before a save can lose unsaved progress. Reconnects use the same history cursor and do not repeat an already prepared report. Dismiss the report or open the full History panel to explore further.

For a controlled Chromium test without affecting your real world, choose an unused path and run:

```bash
npm ci
node scripts/welcome-back-demo.js create /tmp/willowbrook-welcome-check.json
node scripts/welcome-back-demo.js serve /tmp/willowbrook-welcome-check.json &
fixture_pid=$!
```

1. Open `http://127.0.0.1:3017` in Chromium. The first visit has no welcome-back report. Close the tab while the fixture server keeps running.
2. In the same terminal, run `kill -USR1 "$fixture_pid"`. This advances time and applies one existing friendship interaction **only in the test fixture**, then saves it.
3. Reopen the same address in the same Chromium profile. The report should show the event and elapsed simulated time. Select **Explore the town history** to investigate it, or dismiss it; refreshing should not repeat that event.
4. Stop the fixture with `kill -TERM "$fixture_pid"`. The fixture binds only to localhost and refuses to overwrite an existing file. The signal-based trigger is only for this test; normal gameplay records qualifying events automatically.

### Town statistics

Select **Stats** in the top bar to inspect current residents, existing buildings, and permanent historical-event counts. Values are current when the panel opens or when you select **Refresh**; the existing top bar continues to show live time and population. Category totals are derived from stored events, not AI estimates.

At each transition to a new simulation day, the server records the active population at the end of the day just completed. Observations are saved with the world and its previous-save `.bak`, with at most one per day. An older world has no observations before this feature starts; missing days are not filled in. The population chart displays individual measured points, not an interpolated line. Use **Older days** and **Newer days** to view bounded pages of up to 50 observations. The read-only `/api/town-statistics` endpoint exposes the same data; `limit` is 1–100 and `beforeDay` pages backwards.

To test without touching your real world, use an unused absolute path:

```bash
npm ci
node scripts/town-statistics-demo.js create /tmp/willowbrook-statistics-check.json
node scripts/town-statistics-demo.js serve /tmp/willowbrook-statistics-check.json
```

Open `http://127.0.0.1:3017` in Chromium and select **Stats**. Compare the population with the top-bar resident count and the totals from `/api/town-statistics`; check the category counts, the unchanged-population dots and the older/newer pages. Day 31 is intentionally missing in the fixture. Stop the fixture server with Ctrl+C and start it again with the same `serve` command to check the observations persist. The fixture binds only to localhost, uses no AI, and refuses to overwrite existing files. Its population changes are controlled test data, not new gameplay mechanics.

### Generational calendar

The calendar uses the same absolute simulation day as the existing clock: by default Days 1–12 are Year 1, Days 13–24 are Year 2, and so on. A simulation day still has 24 hours, and at 1× one in-game minute still takes five real seconds. The status bar shows the year alongside the existing absolute day and time. `/api/state` and `/api/stats` also expose `calendar` with `year`, `dayOfYear`, and `daysPerYear`.

For a **new** world, set `CALENDAR_DAYS_PER_YEAR` to a positive integer in the deployment `.env` before starting the container (or in the environment for a Node.js run). If unset, the default is `calendar.daysPerYear` in `config/default.json`, currently 12. The selected length is saved in `data/state.json` under `calendar` and included in the existing previous-save `.bak`. Later configuration changes do not alter that world's calendar. A legacy save with no calendar adopts the then-configured length when first opened; that choice is fixed once the world is saved. As with other unsaved changes, a crash before the next save can lose that migration. There is no separate browser backup/export feature on this branch; back up the world data volume.

Future systems can subscribe to `engine.calendar.on('day', listener)` and `engine.calendar.on('year', listener)` and register `engine.calendar.onAnniversary(dayOfYear, listener)`, which returns an unsubscribe function. Notifications are generated at real simulation day boundaries, never simply by loading a save. Anniversary registrations are runtime subscriptions: a future feature must restore its own subscriptions on startup and save any effects with the world. No birthdays or aging are implemented here.

To check a year boundary quickly without modifying a real world:

```bash
npm ci
node scripts/calendar-demo.js create /tmp/willowbrook-calendar-check.json
node scripts/calendar-demo.js serve /tmp/willowbrook-calendar-check.json
```

Open `http://127.0.0.1:3017` in Chromium. The isolated fixture begins paused at Year 1, Day 12, 23:59. Select 5× to see Year 2, Day 13 after about one real second; pause to inspect it. `/api/state` shows the same server calendar. Stop the fixture with Ctrl+C and run the same `serve` command again to verify the calendar survives restart. Choose a different absolute path if the fixture exists. It binds only to localhost and never overwrites a real save.

### Ages and birthdays

A resident's age is derived from their saved `birthDate` (calendar year and day of year) and the current simulation date. Years before the town's Year 1 can be zero or negative, allowing founding adults without changing the town calendar. Age is not stored as a separate changing number. The character profile shows age and birthday; `/api/characters` and `/api/character/<id>` also return them.

For an older world, residents without a birth date receive deterministic, varied adult ages and birthdays based on their existing IDs and the world's saved year length. Existing valid `age` and `birthday` fields are used when present and converted into the single birth date. Existing valid birth dates are retained. Invalid or conflicting prior age information stops startup rather than being silently overwritten. The migration becomes durable on the next successful world save; as with other unsaved changes, an abrupt crash before saving can lose it. It does not alter residents' relationships, personalities, jobs, or memories.

Age changes at the start of the resident's birthday in simulation time, with no wall-clock timer. Ordinary birthdays do not create historical records. Birthdays at ages 10, 20, 30 and so on create one `birthday_milestone` record, which can be explored in History; age remains accurate even without a record. Older application versions may not recognize this new event type, so retain a separate world backup before upgrading or rolling back. This does not introduce childhood behavior, aging restrictions, reproduction, or mortality. Future systems adding residents should supply a valid `birthDate` when creating them.

To check birthdays in an isolated world:

```bash
npm ci
node scripts/aging-demo.js create /tmp/willowbrook-aging-check.json
node scripts/aging-demo.js serve /tmp/willowbrook-aging-check.json
```

Open `http://127.0.0.1:3017` in Chromium. The fixture is paused at Year 1, Day 12, 23:59: Alice is 29 with a birthday on day 1 of the year, and Bob is 31 with a birthday on day 6. Select each through Townsfolk to inspect their profiles. Select 5×, wait for Year 2, Day 13, and pause: Alice should be 30 while Bob remains 31. `/api/characters` shows the same values, and History contains Alice's age-30 milestone. Stop with Ctrl+C and repeat the `serve` command to verify the ages and milestone persist. The fixture uses no LLM, binds only to localhost, and refuses to overwrite an existing file.
