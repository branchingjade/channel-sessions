# Channel Sessions

A [Hermes](https://hermes-agent.nousresearch.com) desktop plugin that puts every
gateway conversation under one roof. Filter channel sessions by **platform,
person, status, type, and free-text search** — then inspect messages inline,
rename, pin, archive, or delete sessions from a single three-column view.

Built for people who run Hermes as a multi-channel assistant (Feishu, Telegram,
Discord, Slack…) and need to find "that conversation with 苑津铭 last week"
without hunting through per-channel UIs.

![screenshot placeholder](docs/screenshot.png)

> **Screenshot**: replace `docs/screenshot.png` with a capture of the plugin
> page (sidebar nav → **Channel Sessions**).

## Features

- **Three-column layout** — filter sidebar · session list · inline message detail
- **Multi-condition filters** — platform × person × group/channel × status × type × search, combined freely
- **Inline message viewer** — user / assistant / tool messages rendered distinctly; long messages and tool payloads collapse by default
- **Session management** — rename, pin, archive, delete (with confirmation), open the full chat page
- **Real-name resolution** — Feishu `open_id` → display name via the bot's contact API, cached on disk for a week
- **Cross-profile** — aggregates the default profile plus every named profile
- **Pagination** — sessions auto-refresh every 15 s; messages load 200 at a time with a "load earlier" button
- **i18n** — English and Chinese UI, follows the app locale
- **UI-state persistence** — filters and search survive app restarts

## Requirements

- Hermes desktop app (plugins load at runtime; the CLI/gateway alone does not)
- Hermes ≥ 0.20 (tested against `hermes-agent` 0.20.x)
- Python 3.11+ for the backend
- Node ≥ 18 only if you run the frontend selfcheck

## Installation

The plugin has two parts: the **frontend** (plain-JS plugin loaded by the
desktop app) and the **backend** (FastAPI endpoints served from the plugin
dashboard).

1. **Copy the frontend** into your Hermes desktop plugins directory:

   ```bash
   # Linux / macOS
   cp -r desktop-plugins/channel-sessions ~/.hermes/desktop-plugins/
   # Windows
   xcopy /E /I desktop-plugins\channel-sessions %LOCALAPPDATA%\hermes\desktop-plugins\channel-sessions
   ```

2. **Copy the backend** into the general plugin directory:

   ```bash
   # Linux / macOS
   cp -r plugins/channel-sessions ~/.hermes/plugins/
   # Windows
   xcopy /E /I plugins\channel-sessions %LOCALAPPDATA%\hermes\plugins\channel-sessions
   ```

3. **Enable the backend** in Hermes `config.yaml`:

   ```yaml
   plugins:
     enabled:
       - channel-sessions
   ```

   (The frontend is managed separately under Settings → Plugins in the desktop app.)

4. Restart the desktop app, or run **Reload desktop plugins** from the command
   palette (⌘K / Ctrl+K). The **Channel Sessions** entry appears in the
   sidebar.

## Usage

Open **Channel Sessions** from the sidebar (or ⌘K → *Open Channel Sessions*).

| Zone | What it does |
|---|---|
| Left sidebar | Search box + filter groups: platform, person, status (pinned/archived), type (DM/group/topic). Click a chip to filter, click again to clear. |
| Session list | Every matching session, newest first. Shows title, type badge, profile badge, person, preview, message count, relative time. Hover the `⋮` menu for rename/pin/archive/delete. |
| Detail pane | Click a session row to read its messages inline. Header shows the person/platform and offers *Open full*, rename, pin, archive, delete. *Load earlier messages* pages through long histories. |

Filter state (including the search term) is remembered across app restarts.

## Backend API

Served under `/api/plugins/channel-sessions` (plugin dashboard, localhost only):

| Method | Path | Purpose |
|---|---|---|
| GET | `/sessions?limit=` | All channel sessions across profiles, with `user_name` resolved for Feishu senders |
| GET | `/messages?session_id=&profile=&limit=&offset=` | Paginated message history (`has_more` flag for paging) |
| POST | `/rename` | `{ session_id, profile, title }` |
| POST | `/archive` | `{ session_id, profile, archived }` |
| POST | `/pin` | `{ session_id, profile, pinned }` |
| POST | `/delete` | `{ session_id, profile }` |

All operations reuse `hermes_state.SessionDB` — the same code path as the
built-in session endpoints.

## Privacy

- `GET /messages` returns only message metadata + content needed for rendering
  (no system prompts, no raw tool dumps beyond what the viewer displays).
- Feishu name lookups are cached in
  `plugins/channel-sessions/dashboard/channel_sessions/data/name_cache.json`
  — a local file mapping `open_id` → display name. It is **never** sent
  anywhere; delete it any time to clear the cache (it will be rebuilt lazily).
- The plugin only reads Hermes' own `state.db` files (read-only SQLite
  connections). Management operations are explicit user actions in the UI.

## Architecture

```
desktop-plugins/channel-sessions/plugin.js   ← React UI (ESM, no build step)
plugins/channel-sessions/dashboard/
├── manifest.json                            ← plugin manifest (api: plugin_api.py)
├── plugin_api.py                            ← FastAPI router (thin HTTP layer)
└── channel_sessions/service.py              ← business logic: DB scan, name lookup, mutations
```

- `service.list_sessions` scans each profile's `state.db` with a read-only
  connection, filters compression child sessions (`parent_session_id`), and
  resolves Feishu real names through a `ThreadPoolExecutor` (max 4 concurrent
  `lark-cli` subprocesses).
- Name lookups are cached with a 7-day TTL; failures are cached as empty so a
  flaky contact API doesn't hammer every refresh.
- Frontend uses React Query (`useQuery`/`useMutation`) against the plugin REST
  backend via `ctx.rest`; filters persist via `ctx.storage`.

## Development

```bash
# Frontend selfcheck (import hygiene + core logic + i18n key parity)
node desktop-plugins/channel-sessions/selfcheck.js

# Backend tests (temporary SQLite fixtures; needs hermes-agent installed)
cd plugins/channel-sessions/dashboard
python -m pytest tests/ -v
```

CI runs both jobs on every push/PR (see `.github/workflows/ci.yml`).

### Adding a locale

UI strings live in the `MESSAGES` dictionary at the top of `plugin.js`
(`en` / `zh`). Add a third locale bundle and register it — the plugin resolves
by the app's active locale, falling back to `en`, then the raw key.

## License

[MIT](LICENSE) © 2026 branchingjade (妖玉)
