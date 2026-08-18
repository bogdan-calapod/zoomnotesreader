# AGENTS.md

Guidance for AI coding agents (opencode, etc.) working in this repo.

## What this project is

A **Cloudflare Email Worker** that converts Zoom AI Companion meeting-summary
emails into **Nextcloud tasks** (VTODOs over CalDAV), which then sync to Apple
Reminders and surface in the owner's `📋 To organize` list for daily triage.

The whole point is to remove the manual step of reading meeting summaries after
back-to-back calls and hand-copying action items. It is **fully hands-off** once
deployed: Zoom summary email → auto-forward → Worker → Nextcloud.

## Architecture (do not reintroduce removed complexity)

```
Zoom summary email
  → auto-forwarded to zoom@<domain>
  → Cloudflare Email Routing hands raw MIME to the Worker (email handler)
  → parse: locate "Next steps" → OWNER_NAME's section → action items
  → write each as a VTODO via CalDAV PUT to the "To organize" list
  → syncs to Apple Reminders
```

Deliberate design decisions — keep these unless the user explicitly asks:

- **Email Worker, not IMAP polling.** Event-driven; no mailbox to store, no cron.
- **No Zoom API / no Zoom OAuth.** The Zoom MCP and REST API are avoided on
  purpose (the MCP was unreliable and OAuth may be admin-gated). The only input
  is the forwarded email.
- **Per-user filtering is mechanical**, riding on Zoom's own per-person grouping
  under "Next steps" — NOT an LLM ownership guess. Do not add an LLM extraction
  step unless asked; it was considered and rejected as unnecessary because Zoom
  pre-attributes items.
- **Zoom deep-links are stripped and discarded.** The user does not use them.
  `splitItemAndLink` still runs to clean the URL off the task title, but the
  `link` value is intentionally unused. Do not re-add link storage.
- **Task prefix `[AI Summary Extracted]`** on every title, so junk from a
  mangled summary is easy to filter/bulk-delete. Keep this prefix.

## Behavioral guarantees (must not regress)

1. **Only the owner's items** become tasks (`OWNER_NAME` in wrangler.toml).
2. **Silent when empty** — a parsed email with no items for the owner writes
   nothing.
3. **Fail loud** — if parsing throws, write exactly ONE task
   `[AI Summary Extracted] ⚠️ Couldn't parse summary: <subject>` so an action is
   never silently lost. Never swallow a parse error into silence.

Any change to the parser must preserve all three. `test/parse.test.mjs` encodes
them — keep it green.

## Files

- `src/index.js`    — Worker: `email()` handler + CalDAV writer. Cloudflare/
  network code lives ONLY here.
- `src/parser.js`   — Pure parsing logic, no dependencies. Shared with the test.
  Put parsing changes here so they stay testable outside the Worker runtime.
- `test/parse.test.mjs` — Runs the parser against a real sample email. This is
  the safety net for Zoom format changes.
- `wrangler.toml`   — Non-secret config (`OWNER_NAME`, `CALDAV_URL`,
  `CALDAV_USER`).
- `README.md`       — Human setup/deploy guide.

## Conventions

- ES modules (`"type": "module"`). Node for the test, Workers runtime for the
  Worker. `nodejs_compat` is on for `postal-mime`.
- Keep `src/parser.js` free of any Cloudflare or `fetch` dependencies so
  `node test/parse.test.mjs` runs standalone.
- Secrets NEVER go in files. `CALDAV_APP_PASSWORD` is a Wrangler secret
  (`wrangler secret put CALDAV_APP_PASSWORD`), a Nextcloud app-password.
- The Worker only ever **writes** to Nextcloud (create-only PUT with
  `If-None-Match: *`). It reads no other user data and exposes no inbound
  surface beyond the email route. Preserve this minimal-privilege shape.

## How to work here

```bash
npm install
npm test          # must be 8/8 before and after any change
npm run dev       # wrangler local dev
npm run deploy    # wrangler deploy
```

### The one fragile point: Zoom's email format

The parser keys off the plain-text structure:
- a line that is exactly `Next steps`,
- a line that is exactly `OWNER_NAME` (the owner's section heading),
- action-item lines beneath it until the next person heading or `Summary`,
- (historically) a Zoom deep-link glued to the end of each item.

If Zoom changes this layout, live emails may stop parsing (you'll see the
fail-loud task fire). To fix: capture a fresh summary email, replace the
`SAMPLE` in `test/parse.test.mjs` with its plain-text body, adjust
`src/parser.js` until the test is green, then redeploy. Do not weaken the
assertions to force a pass.

## Possible future work (only if the user asks)

- Support multiple owners / a team roster.
- Optional LLM-clean pass to rephrase terse Zoom items into imperative task
  lines (was deliberately omitted).
- Map specific meetings to specific Nextcloud lists (e.g. a project list vs.
  "To organize").
- Webhook/manual re-run path for a summary that failed to parse.

## Context notes

- Owner is an Engineering Manager; tasks feed a personal daily 2pm triage ritual
  where each inbox item is blocked, done (<2min), or killed. Tasks should be
  concise, imperative, and self-contained so they can be triaged fast.
- The task destination is the Nextcloud list that syncs to the Apple Reminders
  list named `📋 To organize`.
