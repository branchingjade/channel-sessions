# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-08-08

### Added
- **Language switcher** — header segmented control: Auto (follows the app/device locale) / 中文 / English. Manual choice persists via `ctx.storage`; "Auto" maps the app locale (`zh`/`zh-hant` → Chinese, else English). Custom `useLangT` hook replaces `usePluginI18n` (SDK i18n cannot be overridden per-plugin).
- **Custom categories** — full CRUD in the filter sidebar: create / rename / delete (with confirmation) categories, assign sessions via the row/detail menus (multi-category), category badges on rows and detail header, category filter with counts, cascade cleanup on delete or session deletion. Persisted via `ctx.storage` (`categories` + `sessionCats`).
- **Favorites** — star any session from row/detail menus; favorites filter in the status group; star icon on rows; cascade cleanup on delete. Modeled after Pi Session Manager / Loominary favorites. Persisted via `ctx.storage` (`favorites`).
- **Export as Markdown** — `GET /export?session_id=&profile=` renders metadata header + role-styled messages (👤/🤖/🛠); frontend downloads a `.md` file. Modeled after PSM/Loominary export.

### Fixed
- `validFilters` now falls back correctly for stale pinned/archived/favorites/category filters.
- Selfcheck i18n extraction boundary updated after module-level `t` was removed.

### Changed
- Frontend grew from ~650 to ~1150 lines (language + categories + favorites + export).
- Backend tests: 26 pytest cases (3 new export cases).

[1.4.1]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.4.1

## [1.4.0] - 2026-08-08

### Added
- **Open-source release baseline**: MIT license, README, CHANGELOG, CI (GitHub Actions: frontend selfcheck + backend pytest).
- **i18n**: full English/Chinese localization via `ctx.i18n` (68 keys, reactive via `usePluginI18n`); platform labels, time strings, actions, dialogs and empty states all follow the app locale.
- **Message pagination**: messages load in pages of 200 with a "Load earlier messages" button; backend `GET /messages` accepts `limit` + `offset` and returns `has_more`.
- **Backend hardening**: structured `logging` replaces silent `except: continue`; thread-pooled Feishu name lookup (`max_workers=4`); defensive validation in `_mutate` / `get_messages` (empty session_id, unknown op, unknown profile); `_rows_for_db` tolerates corrupt/unopenable DBs.
- **Test suite**: 23 pytest cases covering path discovery, read-only access, child-session filtering, name caching (fresh/stale/failure), list aggregation, and message pagination.

### Fixed
- Session list now auto-refreshes every 15s (`REFRESH_INTERVAL_MS` was defined but never wired to the sessions query).
- `is_gateway` misclassified `desktop` sessions as channel sessions (now excluded alongside `cli`/`tui`).
- `_rows_for_db` failure to open a profile DB aborted the whole session list (now logged and skipped).

### Changed
- Version unified to 1.4.0 across `plugin.js` and `manifest.json`; manifest gains `author` / `homepage` / `repository` / `license`.
- Platform labels are now English-first (Feishu, WeChat, Scheduled…) matching open-source conventions; UI copy follows the app locale.

## [1.3.0] - 2026-08-06

### Added
- Three-column layout: filter sidebar | session list | inline message detail (user/assistant/tool rendered separately).
- Multi-condition filtering: platform × person × status × type × search, with UI-state persistence (`ctx.storage`).
- Session actions: rename, pin, archive, delete (with confirmation dialog), open in full chat page.
- Feishu open_id → real-name resolution via `lark-cli` with on-disk TTL cache (`name_cache.json`).
- Cross-profile aggregation: scans the default profile plus all named profiles' `state.db`.

[1.4.0]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.4.0
[1.3.0]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.3.0
