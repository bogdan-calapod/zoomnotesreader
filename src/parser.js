/**
 * Pure parsing logic, shared by the Worker (src/index.js) and the test
 * harness (test/parse.test.mjs). No Cloudflare or network dependencies here.
 */

export function extractOwnerActionItems(text, ownerName) {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const nextIdx = lines.findIndex((l) => /^next steps$/i.test(l));
  if (nextIdx === -1) return [];

  let ownerIdx = -1;
  for (let i = nextIdx + 1; i < lines.length; i++) {
    if (isHeading(lines[i], ownerName)) {
      ownerIdx = i;
      break;
    }
    if (/^summary$/i.test(lines[i])) return [];
  }
  if (ownerIdx === -1) return [];

  const items = [];
  for (let i = ownerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^summary$/i.test(line)) break;
    if (isPersonHeading(line)) break;
    const { text: itemText, link } = splitItemAndLink(line);
    if (itemText) items.push({ text: itemText, link });
  }
  return items;
}

export function isHeading(line, ownerName) {
  return line.toLowerCase() === ownerName.toLowerCase();
}

export function isPersonHeading(line) {
  if (line.includes("tasks.zoom.us")) return false;
  if (/[.:;]/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  return words.every((w) => /^[A-Z][\w'’.-]*$/.test(w));
}

export function splitItemAndLink(line) {
  const m = line.match(/(https?:\/\/tasks\.zoom\.us\S*)$/i);
  if (m) {
    const link = m[1];
    const text = stripBullet(line.slice(0, line.length - link.length).trim());
    return { text, link };
  }
  const m2 = line.match(/(https?:\/\/\S+)$/i);
  if (m2) {
    const link = m2[1];
    const text = stripBullet(line.slice(0, line.length - link.length).trim());
    return { text, link };
  }
  return { text: stripBullet(line), link: null };
}

/**
 * Remove a leading bullet marker (`* `, `- `, `• `, with or without the
 * trailing space) from an action-item line. Zoom's plain-text rendering
 * sometimes prefixes each item with a bullet; the task title shouldn't keep it.
 */
export function stripBullet(text) {
  return text.replace(/^\s*[*\-•]\s*/, "");
}
