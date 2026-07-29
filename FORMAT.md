# The backlog format

Autobahn parses one markdown file (default `BACKLOG.md`) with a small,
strict-enough grammar. The file stays pleasant to read and edit by hand —
the board is just a view of it.

## Lanes

A lane is a `##` heading whose text exactly matches a configured lane name
(default: `Now`, `Next`, `Later`):

```
## Now

## Next

## Later
```

Everything between one lane heading and the next belongs to that lane.
Content above the first lane (a title, an intro, this format note) is
ignored by the board.

## Cards

A card is a `##` heading of the form `PREFIX-N · Title` — any uppercase
prefix, a number, the ` · ` separator (middle dot, spaces on both sides),
then the title:

```
## TASK-004 · Ship the onboarding email
- **Status:** open (waiting on copy review)
- **Size:** S
- **Tags:** growth
- **Why:** new signups get silence for 3 days; the email closes the gap.
- **Spec:** one plain-text email, sent 24h after signup, skippable via config.
- **Done means:** a new signup receives it; opt-out honored.
```

Everything until the next `##` heading is the card's body. The body is free
markdown — the board renders all of it in the card's lightbox.

### Fields the board reads

Fields are bold-labeled list items. All are optional:

- `**Status:**` — shown on the card face (first two lines). Two magic
  behaviors:
  - A status starting with `done`, `shipped`, `resolved`, `retired`,
    `retracted`, `sent`, or `superseded` (case-insensitive) moves the card
    to the **Shipped** column, wherever it sits in the file. Writing
    `SHIPPED` or `DONE` in the card's *title* does the same.
  - A status starting with `blocked` marks the card blocked on its face
    (legacy spelling — prefer the `**Blocked:**` field).
- `**Blocked:**` — the blocked flag. Present means blocked; the value is
  the reason (`on: TASK-002 — shortcuts need somewhere to point`). The
  board's block/unblock action writes and removes exactly this line.
- `**Size:**` — rendered as a chip (`S`, `M`, `XL`, whatever you use).
- `**Tags:**` — rendered as a chip. First token only; keep it short.

Any other fields (`**Why:**`, `**Spec:**`, `**Done means:**`, your own) are
body content — visible in the lightbox, ignored by the board logic. The
template minted by New card includes Why / Spec / Done means because we
found cards without them rot; delete what you don't use.

Field values may contain indented Markdown. Keep continuation lines indented
beneath the field bullet; lists, nested lists, task lists, blockquotes, fenced
code, tables, links, images, and ordinary hard-wrapped prose render in the
field's lightbox section:

````markdown
- **Spec:** Ship these outcomes:
  1. Preserve the document as stable context.
  2. Make the next action obvious.
     - [x] Cover the primary workflow.
     - [ ] Cover recovery paths.

  ```js
  verifyWorkflow()
  ```
````

## Pinned notes

A `##` heading inside the **first** lane that is *not* a card (no
`PREFIX-N · ` shape) renders as a pinned note above the board — for sprint
goals, standing reminders, "read this first" blocks:

```
## Now

## Sprint — week of March 3
Ship the importer. Everything else waits.

## TASK-012 · Importer: CSV mapping UI
- **Status:** open
```

## What Autobahn writes

Four operations, all plain-text edits:

- **Move** — the card's block (heading through the line before the next
  heading) is cut and inserted at its new position. Bytes are preserved.
- **New card** — the next `PREFIX-N` id is minted (scanning the file for
  the highest existing number with your configured prefix) and a template
  card is appended to the lane.
- **Ship** — dropping a card on the Shipped column rewrites its Status
  line to `shipped (<date> via Autobahn)` (adding one if the card had
  none). Shipped is derived from status, so the card's block stays where
  it sits in the file.
- **Block / unblock** — inserts, replaces, or removes the card's single
  `- **Blocked:** reason` line (after Status when present). Unblocking a
  legacy card whose Status line itself starts with `blocked` rewrites that
  status to `open (unblocked <date> via Autobahn)`.

Nothing else in the file is ever touched. Hand-edits and board edits
coexist; the file re-parses on every request, so edits from your editor
show on the next refresh.
