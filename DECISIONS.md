# Decisions

- 2026-10-08 — Sync server: Hocuspocus 4.7 (open source, MIT) instead of a hand-written WebSocket server.
- 2026-10-08 — Audience: research group first, internal testing; public later.
- 2026-10-08 — LaTeX math (KaTeX, `$...$` and `$$...$$`) is part of the MVP.
- 2026-10-08 — Self-hosted. SQLite for now; move to PostgreSQL if several servers are needed.
- 2026-10-08 — Access for the MVP: one shared group password; personal accounts in M4.
- 2026-10-08 — Security hardening (before M4), no new dependencies:
  - Server-side sessions in SQLite (only SHA-256 of the token stored), 7-day expiry, real logout that
    also disconnects open editors. `SESSION_SECRET` is no longer used. Changing `GROUP_PASSWORD`
    ends all sessions (a salted scrypt fingerprint of it is kept in the `meta` table).
  - Listen on 127.0.0.1 by default; refuse to listen elsewhere without a password; password ≥ 12 chars.
  - Login throttling: 5 failures per IP per 15 min (in memory). Client IP via Express `trust proxy`
    (`TRUST_PROXY`, default loopback) so it can't be spoofed by clients.
  - Origin must match Host for every non-GET request and for the WebSocket handshake
    (rejected in Hocuspocus `onUpgrade`, before any document is loaded). Cookies stay SameSite=Lax so
    shared note links still open while logged in.
  - CSP: connect-src only our own ws(s) origin; images only self/data/blob (external images blocked
    to prevent read-tracking); form-action 'self'. style-src keeps 'unsafe-inline' because
    CodeMirror and KaTeX need inline styles.
  - DOMPurify also forbids <style> and form controls in notes.
  - Docker: non-root user, read-only root filesystem, all capabilities dropped, no-new-privileges.
  - Not done: per-note size cap (rejecting Yjs updates could leave a note stuck); waits for M4/M6.
- 2026-10-08 — AI rephrase (select text → Claude suggests a rewrite):
  - New dependency `@anthropic-ai/sdk` (official client: typed errors, retries, timeouts) instead of
    hand-written HTTP calls.
  - The server only returns a suggestion; the browser applies it through CodeMirror → yCollab → Yjs,
    so it syncs like any edit, is undoable, and no server-side text editing is needed. Yjs relative
    positions track the selection; if the text changed meanwhile, the replacement is refused.
  - Model `claude-opus-5-5` at effort `low` (simple task), overridable with `AI_MODEL`; server-side
    refusal fallback (`fallbacks: "default"`) enabled.
  - Off unless `ANTHROPIC_API_KEY` is set. Same access checks as other routes, max 4000 characters,
    10 requests per person per minute. Only the selection is sent to Anthropic.
- 2026-10-08 — Editor redesign: formatting toolbar, text colour and highlight, personal appearance.
  - Colours are written into the Markdown as `<span style="color:#hex">` / `<mark style="background-color:#hex">`
    (portable, visible to everyone). The sanitiser keeps only `color`/`background-color` with hex values in
    note HTML; KaTeX's own output keeps its layout styles, and `#preview` has `contain: paint` so nothing
    in a note can draw outside the page.
  - Fonts, text size, theme (Auto/Light/Paper/Dark) and page width are per-person settings in
    localStorage, applied before first paint by `public/theme.js` (an external script, CSP-safe).
  - Fonts are self-hosted (the CSP blocks font CDNs): new devDependencies @fontsource-variable/inter,
    source-serif-4, literata, jetbrains-mono and @fontsource/atkinson-hyperlegible, copied by the build
    (latin subset, ~460 KB total). @codemirror/language and @lezer/highlight are now declared
    explicitly (they were already installed via CodeMirror) for the theme-aware syntax colours.
  - All toolbar actions are CodeMirror changes, so they sync through Yjs and are undoable.
- 2026-10-08 — Published to a public GitHub repo. `.gitignore` keeps out `.env*` (except `.env.example`),
  `data/` and any `*.sqlite*`, build output and test screenshots; commits use the GitHub noreply email.
  Added SECURITY.md (private vulnerability reporting). README now combines the product overview and the
  technical guide; screenshots live in docs/images/.
- 2026-10-08 — License: GNU AGPL-3.0-or-later. Keeps the public code open while stopping closed hosted
  forks (modified network deployments must share their source), and leaves the author free to sell
  hosting or dual-license. All ~200 dependencies are permissive (MIT/ISC/BSD/Apache/MPL-or-Apache, fonts
  OFL-1.1) and AGPL-compatible. Home page links to the source code (AGPL §13). package.json stays
  "private" so it is never published to npm by accident.
- 2026-10-09 — M4 personal sign-in, "My notes" / "Shared with me", private / view / edit links.
  - Sign-in: email magic link AND GitHub OAuth (user's choice); access by email domain only (`ALLOWED_DOMAINS`,
    subdomains included). GitHub accounts need a *verified* address at an allowed domain. Accounts are keyed by
    email, so both methods reach the same account. No passwords stored. `GROUP_PASSWORD` removed.
  - Magic links: 32-byte random token, only its SHA-256 stored, single use, 15 min. The emailed GET link shows a
    confirm button and the POST consumes it, so mail scanners that prefetch links can't use them up.
    Rate limits: 3 emails per address and 10 per IP per 15 min. Without SMTP_URL links are printed to the log.
  - New dependency nodemailer (MIT-0, no sub-dependencies) to send sign-in emails over SMTP. GitHub OAuth uses
    plain fetch (no dependency); GITHUB_OAUTH_URL / GITHUB_API_URL exist only so tests can use a fake GitHub.
  - Access = max(owner, member role, link setting). Checked on every page/API route and in Hocuspocus onConnect;
    viewers get `connectionConfig.readOnly = true`, so the server discards their updates. Sharing changes call
    refreshConnections(): 4403 closes revoked editors, 4409 makes changed ones reconnect with new rights.
  - Removing a domain from ALLOWED_DOMAINS invalidates its sessions (domain re-checked on every request).
  - Migration: notes created before M4 have no owner and become link_edit (existing links keep working);
    OWNER_FOR_EXISTING_NOTES hands them to one person. Old group sessions are dropped.
  - Local mode (no ALLOWED_DOMAINS, loopback only): one implicit user, so trying it out needs no setup.
- 2026-10-09 — Pilot readiness:
  - CI (GitHub Actions, Node 22 + 24): npm audit (high+ fails), build, security, access, rephrase, backup drill,
    two-person editing and formatting tests on every push/PR. No secrets needed (fake Claude and GitHub).
    two-users.mjs now exits non-zero on failure so CI can catch it.
  - Dependabot: weekly updates for npm, GitHub Actions and the Docker base image; security alerts and fixes on.
    Private vulnerability reporting on (SECURITY.md points to it).
  - GET /healthz (public, reveals only ok / database unavailable); Docker HEALTHCHECK uses it.
  - scripts/backup.mjs: SQLite online backup (safe while running), integrity check, keep newest N.
    scripts/restore.mjs: refuses while the port is in use or the file is damaged; keeps the old DB for undo.
    test/backup.mjs rehearses backup → change → restore → verify (saved text and live Yjs document).
  - Docker: multi-stage build on node:24-trixie-slim; npm/corepack removed from the runtime image. The base-image
    scan went from 4 critical + 21 high to 0 critical + 9 high. Image build itself not yet tested (no Docker here).
- 2026-10-09 — `main` protected with a repository ruleset ("Protect main"): changes only via pull request, CI jobs
  `test (22)` and `test (24)` must pass, no force-push, no deletion. Repository admins may bypass in an emergency.
  No approving review required (single maintainer). The first protected PR fixed a flaky sign-out test that had
  made CI fail at random.
- 2026-10-10 — Logo: the book-shaped "md_share" mark replaces the "M↓" text badge. The app uses PNG crops of the
  mark (public/logo-mark.png in the top bar and sign-in pages, public/favicon.png as the tab icon); favicon.svg is
  gone. The README shows docs/images/logo.png, with a light-text copy (logo-dark.png) for GitHub dark mode via
  <picture>. No new dependencies; images are served from /assets like the rest, so the CSP is unchanged.
- 2026-10-10 — Renamed the app from MdShare to Labbook (another app already uses "MdShare"). Every visible name
  changed: page titles, top bar, sign-in pages, README, docs and the package name. The README logo is redrawn as
  "labbook" (Inter 800 beside the same book mark). Internal identifiers stay as they were on purpose, because
  renaming them would break existing installs: the database file data/mdshare.sqlite and backup names, the session
  cookies (signing everyone out), localStorage keys (losing people's preferences) and the window.__mdshare test hook.
  The GitHub repository is still sourasb05/md_share.
- 2026-10-11 — Renamed again, from Labbook to Labnotebook, and the GitHub repository from sourasb05/md_share to
  sourasb05/labnotebook (GitHub redirects the old address, including git remotes). README logo redrawn as
  "labnotebook"; links, the CI badge, clone instructions and package name updated. The same internal identifiers
  as before (mdshare.sqlite, cookies, localStorage keys, window.__mdshare) are kept, for the same reasons.
- 2026-10-11 — Docker image tested for the first time (Docker Desktop 29.8, macOS): builds in ~40 s and runs with
  the docker-compose hardening (read-only, cap_drop ALL, no-new-privileges, uid 1000). End-to-end check against
  the container passed 10/10: email sign-in, editing with LaTeX, signed-out and unshared users refused, sharing,
  live co-editing, healthcheck healthy, notes and sessions survive a restart. `docker exec … node
  scripts/backup.mjs` writes to /data/backups as expected. Not yet tried on the Linux production server or behind Caddy.
