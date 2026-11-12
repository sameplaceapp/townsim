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
   ```

   Replace the example image with your own lowercase GHCR owner and repository if using another fork. Replace the other placeholders with real values, or omit those lines. To discover the Pi's addresses, run `hostname -I` and select its private LAN address. This is deployment configuration, not a hard-coded address in the app. Keep the app on a trusted LAN; do not bind it to a public interface or add public router forwarding. The app has no login. Optional LLM settings (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_DAILY_LIMIT`) can be set in `.env`; the default works without an LLM.
5. **If you already have a world**, find the actual volume mounted at `/app/data` before starting the new Compose setup. For example, identify the existing container with `docker ps -a`, then run:

   ```bash
   docker inspect <existing-container> --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
   ```

   Set `WILLOWBROOK_VOLUME_NAME` to the volume name shown beside `/app/data` in `.env`. A new directory or Compose project can otherwise select a different volume and appear to start a fresh world. Back up the existing volume first. Never remove or overwrite it to test a migration.
6. Pull the finished image and start it:

   ```bash
   docker compose -f docker-compose.ghcr.yml pull
   docker compose -f docker-compose.ghcr.yml up -d --no-build
   ```

   Open the Pi's configured address on port 3000, and check `docker compose -f docker-compose.ghcr.yml logs --tail=50` if needed. Compose restarts the container unless it was explicitly stopped. The named volume holds `/app/data/state.json`, its backup, and the AI request counter across container replacement.

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

World state and the AI request counter are stored in `data/` (or the Docker volume). Snapshots are written atomically with a previous backup; if both are unreadable, startup stops rather than replacing the world. Back up this data before upgrading. AI calls run in the background, use a UTC daily attempt limit, and are disabled by default. Set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` if required, and `LLM_DAILY_LIMIT` in `.env` to enable them. The simulation uses rule-based decisions immediately; recent AI results are reused only if the situation matches. After a provider failure, requests pause for one minute. Usage and fallback status are visible in `/api/stats`.
