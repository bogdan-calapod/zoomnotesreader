import PostalMime from "postal-mime";
import { extractOwnerActionItems } from "./parser.js";

/**
 * Zoom Summary -> Nextcloud Tasks (CalDAV) Email Worker
 * ----------------------------------------------------
 * Flow:
 *   Zoom summary email  ->  auto-forwarded to zoom@yourdomain
 *   ->  Cloudflare Email Routing hands the raw MIME to this Worker
 *   ->  parse, find the configured user's "Next steps" action items
 *   ->  PUT one VTODO per item into the Nextcloud "To organize" list
 *   ->  syncs down to Apple Reminders -> appears at 2pm triage
 *
 * Guarantees:
 *   - Only YOUR items (matched by OWNER_NAME) become tasks.
 *   - A meeting with no items for you produces nothing (silent).
 *   - If the email can't be parsed, ONE fail-loud task is created so
 *     an action is never silently lost.
 *
 * All task titles are prefixed with TASK_PREFIX ("[AI Summary Extracted]")
 * so junk from a mangled summary is trivial to filter/bulk-delete.
 */

const TASK_PREFIX = "[AI Summary Extracted]";

export default {
  async email(message, env, ctx) {
    const subject = message.headers.get("subject") || "(no subject)";
    let items = [];
    let parseOk = false;

    try {
      const parsed = await PostalMime.parse(message.raw);
      // Prefer plain text; fall back to stripping the HTML part.
      const text =
        (parsed.text && parsed.text.trim()) ||
        htmlToText(parsed.html || "") ||
        "";

      items = extractOwnerActionItems(text, env.OWNER_NAME);
      parseOk = true;
    } catch (err) {
      console.error("Parse failure:", err && err.stack ? err.stack : err);
      parseOk = false;
    }

    // Decide what to write.
    let tasksToCreate;
    if (!parseOk) {
      tasksToCreate = [
        {
          title: `${TASK_PREFIX} ⚠️ Couldn't parse summary: ${subject}`,
          note: "The email arrived but parsing threw. Open Zoom and pull action items by hand.",
        },
      ];
    } else if (items.length === 0) {
      // Successfully parsed, genuinely nothing for the owner. Stay silent:
      // no task, no notification.
      console.log(`No action items for ${env.OWNER_NAME} in: ${subject}`);
      return;
    } else {
      tasksToCreate = items.map((it) => ({
        title: `${TASK_PREFIX} ${it.text}`,
        note: cleanSubject(subject),
      }));
    }

    // Write each task to Nextcloud. Do them sequentially; volume is tiny.
    // Track how many actually landed so the notification is honest about
    // partial CalDAV failures.
    let written = 0;
    for (const t of tasksToCreate) {
      try {
        await createCalDavTask(env, t.title, t.note);
        written++;
      } catch (err) {
        console.error(`CalDAV write failed for "${t.title}":`, err && err.stack ? err.stack : err);
        // If even the write fails we can't self-heal into Nextcloud;
        // surfacing via logs is the best we can do here.
      }
    }

    // One best-effort ntfy ping per summary email. Never let a notification
    // failure affect task creation — it already happened above. Emoji/subject
    // text goes in the (UTF-8) body; the Title header stays ASCII-safe since
    // HTTP header values can't carry non-latin-1 characters.
    if (!parseOk) {
      await postNtfy(env, {
        title: "Couldn't parse Zoom summary",
        message: subject,
        priority: "high",
        tags: "warning",
      });
    } else if (written > 0) {
      const clean = cleanSubject(subject);
      const bullets = tasksToCreate.map((t) => `- ${t.title.replace(`${TASK_PREFIX} `, "")}`).join("\n");
      await postNtfy(env, {
        title: `${written} task${written === 1 ? "" : "s"} added`,
        message: `${clean}\n\n${bullets}`,
        priority: "default",
        tags: "memo",
      });
    }
  },
};

/**
 * Best-effort push notification via ntfy. No-op if NTFY_URL is unset.
 * Swallows all errors: the tasks are the source of truth, the ping is not.
 *
 * The Title header is forced to ASCII because HTTP header values cannot hold
 * characters outside latin-1; any emoji/subject text belongs in the body.
 */
async function postNtfy(env, { title, message, priority, tags }) {
  if (!env.NTFY_URL) return;
  try {
    await fetch(env.NTFY_URL, {
      method: "POST",
      headers: {
        Title: asciiHeader(title),
        Priority: priority || "default",
        Tags: tags || "",
      },
      body: message || "",
    });
  } catch (err) {
    console.error("ntfy notification failed:", err && err.stack ? err.stack : err);
  }
}

/** Strip anything outside printable ASCII so it's safe as an HTTP header value. */
function asciiHeader(s) {
  return String(s).replace(/[^\x20-\x7E]/g, "").trim() || "Notification";
}

/** Minimal HTML -> text fallback if no plain-text part exists. */
function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|li|tr|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanSubject(subject) {
  // Zoom subjects look like: "Meeting assets for BREADS 🍞 are ready!"
  return subject.replace(/^meeting assets for\s*/i, "").replace(/\s*are ready!?\s*$/i, "").trim() || subject;
}

/**
 * Create a VTODO on the Nextcloud "To organize" list via CalDAV.
 * A VTODO PUT to a new .ics resource is the standard way to add a task.
 */
async function createCalDavTask(env, title, note) {
  const uid = crypto.randomUUID();
  const now = new Date();
  const stamp = toICalDateTime(now);

  // Fold nothing fancy; keep lines short-ish. Escape per RFC 5545.
  const vtodo = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zoom-actions-worker//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${icalEscape(title)}`,
    note ? `DESCRIPTION:${icalEscape(note)}` : null,
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  // CalDAV task collection URL, e.g.:
  //   https://nc.example.com/remote.php/dav/calendars/<user>/<list-id>/
  const base = env.CALDAV_URL.endsWith("/") ? env.CALDAV_URL : env.CALDAV_URL + "/";
  const resourceUrl = `${base}${uid}.ics`;

  const auth = "Basic " + btoa(`${env.CALDAV_USER}:${env.CALDAV_APP_PASSWORD}`);

  const res = await fetch(resourceUrl, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*", // create-only; never clobber an existing resource
    },
    body: vtodo,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CalDAV PUT ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return true;
}

function toICalDateTime(d) {
  // UTC basic format: YYYYMMDDTHHMMSSZ
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

function icalEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
