# zoom-actions-worker

Cloudflare Email Worker that turns Zoom AI Companion summary emails into
Nextcloud tasks (which sync to Apple Reminders), so your action items land in
your `📋 To organize` list automatically and get picked up at your 2pm triage.

## What it does

1. You auto-forward Zoom summary emails to `zoom@yourdomain`.
2. Cloudflare Email Routing hands the raw email to this Worker.
3. The Worker finds the `Next steps` block, then **your** section (by name),
   and extracts each action item.
4. Each item becomes a VTODO in your Nextcloud "To organize" list, titled
   `[AI Summary Extracted] <the action>`, with the Zoom deep-link stored in the
   task note.

### Guarantees

- **Only your items.** Matched by `OWNER_NAME`; everyone else's are ignored.
- **Silent when empty.** A meeting with no action items for you creates nothing.
- **Fail loud.** If an email can't be parsed, it creates ONE task
  `[AI Summary Extracted] ⚠️ Couldn't parse summary: <subject>` so an action is
  never silently lost.
- **`[AI Summary Extracted]` prefix** on every task, so anything junky from a
  mangled summary is trivial to spot and bulk-delete.
- **One ntfy ping per summary.** After the tasks are written, you get a single
  push notification (via `NTFY_URL`) listing what was added — or a high-priority
  ping if the summary failed to parse. An empty summary pings nothing.

## Setup

### 1. Install + test

```bash
npm install
npm test          # runs the parser against a real sample — should be 13/13
```

### 2. Fill in wrangler.toml

Set these under `[vars]`:

- `OWNER_NAME` — the exact name Zoom uses for you in the "Next steps" list
  (e.g. `Bogdan Calapod`). Must match the heading exactly.
- `CALDAV_USER` — your Nextcloud username.
- `NTFY_URL` — full ntfy topic URL for push notifications, e.g.
  `https://ntfy.sh/bogdan-email-notifs`. Leave unset to disable notifications.
- `CALDAV_URL` — the full CalDAV collection URL of your "To organize" list,
  **with a trailing slash**. To find the list id:
  - In Nextcloud Tasks/Calendar, the CalDAV path looks like:
    `https://<host>/remote.php/dav/calendars/<user>/<list-id>/`
  - The `<list-id>` is the internal slug of the list, not its display name.
    You can list your collections with:
    ```bash
    curl -u USER:APP_PASSWORD -X PROPFIND \
      -H "Depth: 1" \
      https://<host>/remote.php/dav/calendars/<user>/ | grep -i href
    ```
    Pick the one whose display name is "To organize".

### 3. Set the secret

Never put the app password in the file. Create a **Nextcloud app password**
(Settings → Security → Devices & sessions → Create new app password) and:

```bash
npx wrangler secret put CALDAV_APP_PASSWORD
```

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. Wire up Cloudflare Email Routing

1. Cloudflare dashboard → your domain → **Email** → **Email Routing**.
2. Enable it (adds the MX + SPF records automatically).
3. Under **Routing rules**, create a custom address `zoom@yourdomain`.
4. Set its action to **Send to a Worker** → pick `zoom-actions-worker`.

### 6. Auto-forward from Zoom / Outlook

Create a rule in whatever receives the Zoom summary emails (Outlook/M365)
that auto-forwards any email from Zoom's summary sender to
`zoom@yourdomain`. Match on sender + subject like "Meeting assets for … are
ready" to avoid forwarding unrelated Zoom mail.

## Files

- `src/index.js` — the Worker (email handler + CalDAV writer).
- `src/parser.js` — pure parsing logic (shared with the test).
- `test/parse.test.mjs` — runs the parser against the real sample email.
- `wrangler.toml` — config + non-secret vars.

## When Zoom changes their email format

The parser keys off:
- a line that is exactly `Next steps`,
- a line that is exactly your `OWNER_NAME`,
- action items being the lines under it until the next person / `Summary`,
- the Zoom deep-link glued to the end of each item.

If Zoom changes any of that, `npm test` is where you'll catch it — update the
`SAMPLE` in the test to a fresh email, adjust the parser until it's green, then
redeploy. The fail-loud task also tells you in real time when a live email
stops parsing.
