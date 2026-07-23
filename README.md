# Autobahn

A kanban board that lives in your markdown. Zero dependencies, one file of
server, one file of UI. Your `BACKLOG.md` stays the single source of truth —
Autobahn renders it as lanes, and dragging a card rewrites the file,
byte-for-byte. Commit as usual.

Built at [Rams](https://www.rams.ai) to run our own backlog; shared because
it turned out to be the whole tool.

## Why

Markdown backlogs are great for working with agents and humans in the same
file: greppable, diffable, reviewable, no lock-in. What they lack is a
glanceable board. Autobahn is that board — nothing more. There is no
database, no accounts, no sync. If you delete Autobahn tomorrow, your
backlog loses nothing.

## Quickstart

One command sets Autobahn up as a resident service — every repo under
your code root gets a board at a stable, portless HTTPS URL:

```
npx github:0xSMW/autobahn setup ~/code   # → https://autobahn.localhost
```

Setup clones the app to `~/.autobahn`, installs
[portless](https://www.npmjs.com/package/portless) (a local HTTPS proxy
that gives dev servers named `.localhost` URLs), and — on macOS —
registers a LaunchAgent so the board is always on. Re-run it any time to
update. Run `portless trust` once if the browser warns about the
certificate.

Just trying it out? Serve one directory, install nothing:

```
npx github:0xSMW/autobahn ~/code/my-project   # → http://localhost:4780
```

Autobahn looks for `BACKLOG.md` in each directory (see
[FORMAT.md](FORMAT.md) for the card grammar — or copy
`example/BACKLOG.md` as a starter). Every other `.md` file in a board's
directory shows up as a read-only rendered tab.

Requires Node 18+. The server itself has zero dependencies; portless is
the one optional global that setup adds.

### Dynamic routes

The route picks the board: any subdirectory with its own `BACKLOG.md` is
served live at its path — `https://autobahn.localhost/my-project/` — no
restart needed. Visiting a directory without a backlog lists the boards
found beneath it, with a one-click way to start one. Each project
directory may carry its own `autobahn.config.json`.

## Portless

Setup runs Autobahn through portless, which owns ports 80/443 and routes
by hostname; the server honors the `$PORT` it injects. Useful commands:

```
portless list                                      # show active routes
portless autobahn node --watch server.mjs ~/code   # run by hand, auto-restart on edits
portless alias autobahn 4780                       # static route to a fixed port instead
```

No portless? `--domain` (optionally `--domain=my.localhost`) binds port 80
on loopback directly when it's free, for a plain-http portless URL:

```
node server.mjs ~/code --domain     # → http://autobahn.localhost
```

## What it does

- **Lanes** — `## Now`, `## Next`, `## Later` headings in the backlog open
  lanes; every `## PREFIX-N · Title` block under them is a card.
- **Drag to move** — between lanes, or onto a card to insert before it.
  Both splice the card's markdown block into its new position and write the
  file back.
- **Shipped is derived** — cards whose Status starts with done / shipped /
  resolved / retired (or whose title says so) collect in a Shipped column
  automatically. No archiving ritual.
- **New card** — mints the next id (`TASK-007`) and appends a template card.
- **Card lightbox** — click any card for its full rendered body.
- **Pinned notes** — non-card `##` blocks inside the first lane render as
  pinned notes above the board (sprint goals, standing reminders).
- **Docs tabs** — the rest of your project's markdown, rendered read-only.
- **Live reload** — the server watches the board directory (OS file
  events, no polling); edit the markdown in your editor and the open board
  refreshes itself.
- **Dirty flag** — shows when the board file (and only the board file) has
  uncommitted changes. Click it to preview a generated commit subject
  ("backlog: TASK-007 carded · TASK-003 → Now"), click again to commit —
  just that file, never the rest of the repo.

## Configuration

Optional `autobahn.config.json` next to your backlog:

```json
{
  "backlog": "BACKLOG.md",
  "docs": ["PLAN.md", "NOTES.md"],
  "lanes": ["Now", "Next", "Later"],
  "prefix": "TASK",
  "port": 4780,
  "domain": "autobahn.localhost"
}
```

Everything is optional. Without `docs`, every `.md` in the directory (except
the backlog) becomes a tab. `prefix` is what New card mints; existing cards
can use any `PREFIX-N` id.

## Design notes

- The file is the database. Autobahn never stores state of its own.
- Writes are whole-block splices — a moved card is the same bytes in a new
  position, so diffs stay readable and merge conflicts stay rare.
- Intended for localhost. There is no auth; don't expose the port.
- The markdown renderer is deliberately small and only fed your own local
  files.

## License

MIT © Rams (rams.ai)
