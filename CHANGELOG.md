# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-08-09

### Fixed (render crash — critical)
- **Page failed to render with `t is not a function`** on first mount in the real desktop app (v1.5.0 regression). `useLangT` depended on the SDK's `useI18n()` hook whose live shim shape differs between the dev bundle and the packaged app — under the packaged runtime it did not yield a callable `t`, so every `t(...)` in the page threw during render.
- Fix: `useLangT` no longer imports/uses `useI18n`. Locale detection now uses `navigator.language` (with `zh*` → Chinese mapping and a safe fallback to `en`); `t` is a plain closure over `MESSAGES[resolved]` instead of a `useMemo`-wrapped factory. Removed the now-unused `useI18n` SDK import.
- Verified: syntax (node --check), selfcheck 21 items (118 i18n keys), component simulation (mock hooks execute `ChannelSessionsPage` without throwing), pytest 28, class audit 0 missing.

[1.5.1]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.5.1

## [1.5.0] - 2026-08-09

### Added (feature pass — full-line functional upgrades)
- **Full-text search**: new backend `GET /search?q=` scans `messages.content` across all profiles (LIKE match, newest-first, deduped to one hit per session with session context). Frontend: typing ≥2 chars in the search box shows a live "N message hits in content" badge in the list header — click it to jump to the first hit session.
- **Right-click context menu** on session rows: open full session / copy title / copy session ID / favorite / pin / archive / delete (positioned at cursor).
- **Bulk pin / bulk archive** in the batch bar (select mode) — alongside the existing bulk category assign; sessions are never deleted.
- **Sort switching** in the list header: recent activity (default) / oldest first / by title (locale-aware `zh-Hans-CN`), persisted to storage.

### Changed
- `plugin_api.py` routes 7 → 8 (`/search`); `service.py` +67 lines (`search_messages`).
- Session-row menu unchanged; right-click menu is additive.

### Fixed
- N/A.

[1.5.0]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.5.0

## [1.4.3] - 2026-08-09

### Added
- **Rename display name** (list-management rework): every object row (person / group / category) now has an always-visible ✏️ button that opens a rename dialog — changes only the name shown in the list (`displayOverrides` in `ctx.storage`), never touches the underlying session data. Clearing the input restores the default.
- **Batch assign category**: new select mode on the session list (checklist button in the list header) — check multiple sessions, then assign a category to all of them at once via the batch bar.

### Removed
- **Batch delete of sessions by object** (`POST /delete-by-object` + backend `delete_by_object` + the trash button on object rows). Deletion is now scoped to a single session from the row/detail menu only; object rows no longer offer destructive bulk actions.

### Changed
- Category delete stays pure: deleting a category only removes it from `sessionCats` mappings — sessions are untouched (unchanged from 1.4.1, now covered by tests).
- Frontend: `objectLabel()` honours `displayOverrides` first; `buildFilterOptions` receives overrides for list labels.
- Backend: `plugin_api.py` down to 7 routes (no delete-by-object); `service.py` drops the now-unused `_object_key`/`delete_by_object`.

### Fixed
- N/A (no bug fixes in this release; pure list-management scope).

[1.4.3]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.4.3

## [1.4.2] - 2026-08-09

### Fixed (critical UI regression)
- **Plugin rendered broken**: several Tailwind classes used by the plugin do not exist in Hermes' compiled CSS (Hermes builds CSS from its own source only; plugin files are outside the build graph). Missing classes made message bubbles/avatars/hover backgrounds transparent (`--ui-fill-tertiary`/`--ui-fill-secondary` don't exist — the app uses `--ui-bg-*`), broke text sizes (`text-[10.5px]`/`[12.5px]`/`[13px]`), the session-list width (`w-[380px]`), badge truncation (`max-w-24`), and the sidebar header height (`min-h-[30px]`).
- All 93 plugin classes now verified to exist in the compiled CSS via `tests/audit_classes.py` (Tailwind-escaped exact match against the dist asset).
- Category row actions (rename/delete) are now always visible instead of hover-only (`opacity-0 group-hover:opacity-100`) — users couldn't discover them, and could mistake the session "delete" menu for category deletion.

### Changed
- Backend: `GET /export` added in 1.4.1 (this patch round-trips it into the repo with tests).

[1.4.2]: https://github.com/branchingjade/channel-sessions/releases/tag/v1.4.2

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
