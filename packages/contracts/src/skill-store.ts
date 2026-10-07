/**
 * Skill Store: bundled, curated SKILL.md skills installable per user from the
 * Skills & Connectors page. Content is imported from AutoClaw's portable skill
 * set by `scripts/import-autoclaw-skills.mjs` (see skill-store.generated.ts).
 */

import { SKILL_STORE_JSON } from "./skill-store.generated.js";

export const SKILL_STORE_CATEGORIES = [
  "Research",
  "Utilities",
  "Productivity",
  "Development",
  "Content Creation",
  "Finance & Trading",
] as const;
export type SkillStoreCategory = (typeof SKILL_STORE_CATEGORIES)[number];

export type SkillStoreEntry = {
  /** Stable slug (source directory name); used as AgentSkill.storeKey. */
  key: string;
  name: string;
  description: string;
  category: SkillStoreCategory;
  /** Full SKILL.md document (frontmatter included). */
  content: string;
};

type SkillStorePayload = {
  version: number;
  categories: string[];
  skills: SkillStoreEntry[];
};

function loadSkillStore(): SkillStoreEntry[] {
  const payload = JSON.parse(SKILL_STORE_JSON) as SkillStorePayload;
  return payload.skills.filter(
    (entry): entry is SkillStoreEntry =>
      typeof entry.key === "string" &&
      typeof entry.name === "string" &&
      typeof entry.description === "string" &&
      typeof entry.content === "string" &&
      (SKILL_STORE_CATEGORIES as readonly string[]).includes(entry.category),
  );
}

// Hand-written first-party skills for the bundled Google connectors — these
// teach the exact google-connector tool names, which no imported store covers.
const BUNDLED_GOOGLE_SKILLS: SkillStoreEntry[] = [
  {
    key: "google-drive",
    name: "Google Drive",
    description:
      "Save, organize, and share files in Google Drive with the gdrive_* connector tools: upload text or binary (base64), create folders, list, and share links.",
    category: "Productivity",
    content: `---
name: google-drive
description: Save, organize, and share files in Google Drive with the gdrive_* connector tools: upload text or binary (base64), create folders, list, and share links.
---

# Google Drive

Tools: \`gdrive_upload_file\`, \`gdrive_create_folder\`, \`gdrive_list_files\`, \`gdrive_share_link\`.
Scope is \`drive.file\`: you can only see files/folders this app created. Never claim a file
exists in Drive unless a tool call confirmed it.

## Uploading

- Text: \`gdrive_upload_file\` with \`name\` (with extension) + \`content\`.
- Binary/files on the computer (images, PDFs, docs the user attached or that you produced):
  read the bytes with shell, then upload base64:
  1. \`base64 -w0 /path/to/file\` (output to stdout; avoid printing huge blobs twice — capture once).
  2. \`gdrive_upload_file\` with \`name\`, \`content_base64\`, and the right \`mime_type\`
     (image/png, image/jpeg, application/pdf, ...).
- Limit: 5MB per upload. If larger, shrink first via shell (e.g. compress/resize the image)
  and say so; if you still cannot, tell the user the file is too big instead of pretending.
- The result gives you \`id\` and \`link\` — report the link.

## Folders

1. Create it first: \`gdrive_create_folder\` with \`name\` (optionally \`parent_id\`). Keep the returned \`id\`.
2. Upload into it: \`gdrive_upload_file\` with \`folder_id\`.
3. List its contents: \`gdrive_list_files\` with \`folder_id\`.

A file name containing "/" is NOT a folder — always use real folders this way.

## Sharing

\`gdrive_share_link\` with \`file_id\` makes the file viewable by anyone with the link and
returns the URL. Ask before making something public.

## Listing

\`gdrive_list_files\` shows app-created files (newest first). Use \`name_contains\` or
\`folder_id\` to narrow it.
`,
  },
  {
    key: "gmail",
    name: "Gmail",
    description:
      "Read, search, and send email through the gmail_* connector tools: search operators, reading full messages, and sending or replying.",
    category: "Productivity",
    content: `---
name: gmail
description: Read, search, and send email through the gmail_* connector tools: search operators, reading full messages, and sending or replying.
---

# Gmail

Tools: \`gmail_search\`, \`gmail_read\`, \`gmail_send\`.

## Searching — \`gmail_search\`

Pass Gmail query syntax in \`query\`; combine operators with spaces:
- \`is:unread\`, \`has:attachment\`, \`from:someone@example.com\`, \`to:me\`
- \`subject:invoice\`, \`newer_than:7d\`, \`after:2026/10/01\` \`before:2026/10/31\`

"Check my mail" flow: \`gmail_search\` with \`is:unread\` (or recent range) → summarize the
list (from / subject / date / snippet) → \`gmail_read\` the ones that matter → report.

## Reading — \`gmail_read\`

Needs \`message_id\` from search results. Returns headers, plain-text body, and attachment
names. Quote only the relevant part when summarizing; do not paste whole emails back.

## Sending — \`gmail_send\`

\`to\`, \`subject\`, \`body\` (plain text). Optional \`cc\`, \`bcc\`, and \`thread_id\`
(from search results) to reply inside an existing thread.

- Write the body for the user in their language, sign off appropriately, and state the
  recipient + subject in your reply. Attachments cannot be attached via this tool — if the
  user wants to send a file, upload it to Drive (see the Google Drive skill) and put the
  share link in the body.
`,
  },
  {
    key: "google-calendar",
    name: "Google Calendar",
    description:
      "View and manage the primary Google Calendar with the gcal_* connector tools: listing a time range, creating events with attendees, and updating events.",
    category: "Productivity",
    content: `---
name: google-calendar
description: View and manage the primary Google Calendar with the gcal_* connector tools: listing a time range, creating events with attendees, and updating events.
---

# Google Calendar

Tools: \`gcal_list_events\`, \`gcal_create_event\`, \`gcal_update_event\`. All operate on the
primary calendar.

## Times

ISO 8601 WITH offset, always: \`2026-10-08T14:00:00+07:00\`. Use the user's local offset
(Thailand = +07:00) unless they say otherwise. "Tomorrow 2pm for 1 hour" means
start \`...T14:00:00+07:00\`, end \`...T15:00:00+07:00\`.

## Listing — \`gcal_list_events\`

\`time_min\` / \`time_max\` (ISO), optional \`query\` free-text filter. To answer "am I free
Friday?", list that whole day and reason about gaps before answering.

## Creating — \`gcal_create_event\`

Required: \`summary\`, \`start\`, \`end\`. Optional: \`description\`, \`location\`,
\`attendees\` (array of email addresses).

- Before creating, confirm back: title, start–end with timezone, attendee list.
- Scheduling from email: read the mail (Gmail skill), propose 1–2 slots that don't overlap
  existing events (check with \`gcal_list_events\` first), then create after the user agrees.
- Add context (address, call link, agenda) into \`description\`/\`location\`, not the title.

## Updating — \`gcal_update_event\`

Needs \`event_id\` from \`gcal_list_events\`; pass only the fields that change. Reschedule =
new \`start\`/\`end\`; tell the user the old vs new time.
`,
  },
];

export const SKILL_STORE: SkillStoreEntry[] = [...loadSkillStore(), ...BUNDLED_GOOGLE_SKILLS];

export function findSkillStoreEntry(key: string): SkillStoreEntry | undefined {
  return SKILL_STORE.find((entry) => entry.key === key);
}
