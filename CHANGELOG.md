# Changelog

## 0.2.3 (2026-11-20)

- A session row shows **finished** when a turn ends, until you start the next one, and the last thing you asked it. Both come from files Claude Code already writes (its session status and the transcript), so they cost no tokens and need no setup.
- Desk no longer picks up a `claude.exe` from a relative `PATH` entry such as `.`, which would resolve inside whatever folder it was started from.

## 0.2.2 (2026-11-07)

- Close a session from its row, and a new docs site.

## 0.2.1 (2026-11-07)

- A Usage page with each account's 5 hour and weekly limits, when they reset, and every live session on the account with its model and context.
- Fixed grey account chips on Welcome and a reset time that could read "3 h 60 m".

## 0.2.0 (2026-11-07)

- Menu bar and title bar search, more than one window over the same sessions, a searchable Settings page, a Welcome page, a full window first run, and windows down to 480 px.
- README rewritten and a docs site under `docs/`.

## 0.1.0 (2026-11-06)

- First public release.
