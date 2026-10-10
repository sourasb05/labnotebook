# Instructions for AI coding assistants working on Labnotebook

Labnotebook is a HackMD-style collaborative Markdown editor for a research group (internal first,
public later). The engineering plan is the source of truth for scope and milestones.

## Hard rules
- Real-time text goes ONLY through Yjs via Hocuspocus. Never write custom merge/diff/OT logic,
  never edit note text on the server except through a Yjs document.
- The Yjs document (Hocuspocus `documents` table) is the source of truth; `notes.markdown` is a
  derived copy for listing, search and download.
- Every route and the WebSocket (`onConnect`) must check access. Add a test whenever you add a route.
- Rendered Markdown must go through DOMPurify. Keep the Content-Security-Policy strict
  (no inline scripts).
- Do not add dependencies without saying why. Keep plain JavaScript (ES modules) unless asked.
- One milestone per session. Finish with `npm run build`, start the server, run
  `node test/two-users.mjs` and `node test/access.mjs`, and report the results.
- Log important choices in DECISIONS.md.
- `main` is protected: work on a branch, open a pull request, and merge only after the CI jobs
  `test (22)` and `test (24)` pass. Never force-push or push directly to `main`.

## Done: M4 — personal sign-in, My Notes, sharing (2026-10-09)
- Email magic link + GitHub OAuth, domain allowlist (`ALLOWED_DOMAINS`); local mode (no sign-in) when unset.
- users, note_members, note_visits, login_tokens; notes.owner_id / share_mode. Viewers are read-only in onConnect.
- Covered by `test/access.mjs` (signed-out access over HTTP + WebSocket, viewer edits rejected, live revocation).

## Next milestone: M5 — version history, image paste, Mermaid diagrams
- Scope and "done when" to be agreed with the user before starting (see the engineering plan).
