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

**Drama Engine** -- Tracks storylines (love triangles, rivalries, grudges, secret keepers, forbidden friendships) through lifecycle phases. Gossip propagates through the social network. Town mood cycles between peaceful and dramatic.

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

## Deployment

### Hostinger VPS

1. SSH into your VPS
2. Install Docker and Docker Compose
3. Clone the repo and set up `.env`
4. Run `docker compose up -d`
5. Configure your reverse proxy (nginx) to forward to port 3000

### Docker Volume

The simulation state persists in a Docker volume (`townsim-data`). Stopping and restarting the container resumes from where it left off.

## License

MIT

### World saves and AI budget

World state and the AI request counter are stored in `data/` (or the Docker volume). Snapshots are written atomically with a previous backup; if both are unreadable, startup stops rather than replacing the world. Back up this data before upgrading. AI calls run in the background, use a UTC daily attempt limit, and are disabled by default. Set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` if required, and `LLM_DAILY_LIMIT` in `.env` to enable them. The simulation uses rule-based decisions immediately; recent AI results are reused only if the situation matches. After a provider failure, requests pause for one minute. Usage and fallback status are visible in `/api/stats`.

### Export a world backup

In a browser on the same machine as the Node.js server, open Willowbrook through `http://localhost:3000` or `http://127.0.0.1:3000` and select **Backup**. The browser downloads a file such as `willowbrook-backup-2026-01-01T12-34-56-789Z.json` (UTC). The simulation continues running and its existing save files are not changed. The backup captures the most recently completed server update, which can lag the animated browser clock by up to one movement update under normal conditions.

The JSON is a normal version-1 `data/state.json` world snapshot with an additional `_backup` object containing the backup format and version, creation time, simulation time, application version, and the AI request budget's persisted day and usage. It does not contain application configuration or credentials. Keep the download in a safe location. It can be inspected with `node -e "const b=require('./YOUR-BACKUP.json'); console.log(b._backup, b.characters.length)"` after substituting the actual filename.

The download is restricted to direct loopback connections with a same-origin local browser. It intentionally rejects LAN, Tailscale, Codespaces forwarding, and reverse-proxy access. A standard Docker published port uses a network bridge and therefore cannot use this browser download; run the Node.js app directly on the same machine to export. Do not expose or proxy the backup route publicly.

There is no restore interface yet. The world fields are directly compatible with the existing state loader; the `_backup.aiRequestBudget` value represents the separate `data/ai-budget.json` file and must also be retained when restoring an AI-enabled world to preserve its request limit. Restoration should be performed only on a separate copy after backing up existing data; never overwrite an existing world as a test.
