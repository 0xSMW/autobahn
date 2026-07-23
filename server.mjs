// Autobahn — a kanban board that lives in your markdown.
// Zero dependencies. Your BACKLOG.md stays the single source of truth:
// this server parses it into lanes, and a drag between lanes rewrites the
// file (the whole ## CARD block moves, byte-for-byte). Commit as usual.
//
//   node server.mjs [dir]                     → http://localhost:4780
//   portless autobahn node server.mjs [dir]   → https://autobahn.localhost (honors $PORT)
//   node server.mjs [dir] --domain            → http://autobahn.localhost (port 80, loopback)
//   node server.mjs [dir] --domain=my.local --port=8080
//
// The route picks the board: any subdirectory of [dir] with its own
// BACKLOG.md is served live at its path — http://autobahn.localhost/team/app/
// — no restart. Visiting a directory without a backlog lists the boards
// under it.
//
// Optional autobahn.config.json in [dir] (project subdirs may have their own):
//   {
//     "backlog": "BACKLOG.md",           // the board file
//     "docs": ["PLAN.md", "NOTES.md"],   // read-only tabs (default: every *.md in dir)
//     "lanes": ["Now", "Next", "Later"], // ## headings that open lanes
//     "prefix": "TASK",                  // id prefix minted by New card
//     "port": 4780,
//     "domain": "autobahn.localhost"     // serve portless on a .localhost name
//   }
import { createServer } from 'node:http'
import { watch } from 'node:fs'
import { readFile, writeFile, readdir, stat, access, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

const argv = process.argv.slice(2)
let dirArg = null, domainArg, portArg
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--domain') domainArg = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : ''
  else if (a.startsWith('--domain=')) domainArg = a.slice(9)
  else if (a === '--port') portArg = Number(argv[++i])
  else if (a.startsWith('--port=')) portArg = Number(a.slice(7))
  else if (!dirArg) dirArg = a
}

const BASE = path.resolve(dirArg || '.')

const DEFAULTS = { backlog: 'BACKLOG.md', docs: null, lanes: ['Now', 'Next', 'Later'], prefix: 'TASK' }
const readConfig = (dir) =>
  readFile(path.join(dir, 'autobahn.config.json'), 'utf8').then(JSON.parse, () => ({}))

// Each request resolves its own project from the route, so boards appear
// and reconfigure without a restart.
async function loadProject(dir) {
  const config = { ...DEFAULTS, ...(await readConfig(dir)) }
  return { root: dir, config, lanes: config.lanes, backlog: path.join(dir, config.backlog) }
}

const exists = (file) => access(file).then(() => true, () => false)

// Docs shown as read-only tabs: config list, or every .md in the directory.
async function listDocs(p) {
  if (Array.isArray(p.config.docs)) return p.config.docs
  const entries = await readdir(p.root).catch(() => [])
  return entries.filter((f) => f.endsWith('.md') && f !== p.config.backlog).sort().slice(0, 12)
}

// A card id is PREFIX-NUMBER for any A-Z prefix (TASK-12, RAMS-057, ABC-9).
const CARD_ID = /^([A-Z][A-Z0-9]*-\d+) · (.+)$/
const DONE_RE = /\b(SHIPPED|DONE|RETRACTED|RETIRED)\b/
// Statuses written in prose ("done (7/4) — ...", "shipped 3.2") count as
// done when the status LINE starts with the verdict.
const DONE_STATUS_RE = /^(done|shipped|resolved|retracted|retired|sent|superseded)\b/i

function parseBacklog(md, lanes) {
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const spanEnd = (idx) => (idx + 1 < heads.length ? heads[idx + 1].i : lines.length)

  let lane = null
  const items = []
  const pinned = [] // non-card ## blocks inside the FIRST lane render as pinned notes
  heads.forEach((h, idx) => {
    if (lanes.includes(h.text)) { lane = h.text; return }
    const m = h.text.match(CARD_ID)
    const body = lines.slice(h.i + 1, spanEnd(idx)).join('\n')
    const field = (name) => (body.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]+)`)) || [])[1]?.replace(/\*/g, '').trim() ?? null
    const status = field('Status')
    // Blocked is a flag: a `**Blocked:**` field (value = reason), with a
    // status starting "blocked" kept as the legacy spelling.
    const blockedWhy = field('Blocked')
    if (m) {
      items.push({
        id: m[1], title: m[2], lane, status, blockedWhy,
        done: DONE_RE.test(h.text) || DONE_RE.test(status ?? '') || DONE_STATUS_RE.test(status ?? ''),
        blocked: blockedWhy != null || /^blocked/i.test(status ?? ''),
        line: h.i + 1,
        body: body.trim(),
        size: field('Size'),
        tags: field('Tags'),
      })
    } else if (lane === lanes[0]) {
      pinned.push({ title: h.text, body: body.trim() })
    }
  })
  return { items, pinned }
}

// Self-heal missing lane headings (empty or hand-started files): any
// configured lane without a `## Lane` heading is appended, in order.
function ensureLanes(md, lanes) {
  const have = new Set()
  md.split('\n').forEach((l) => { if (/^## /.test(l)) have.add(l.slice(3).trim()) })
  const missing = lanes.filter((l) => !have.has(l))
  if (!missing.length) return md
  const sep = md.length && !md.endsWith('\n') ? '\n' : ''
  return md + sep + missing.map((l) => `\n## ${l}\n`).join('')
}

// Move the whole `## CARD` block: before `beforeId` when given (the
// within-lane reorder), otherwise to the END of the target lane.
async function moveItem(p, id, toLane, beforeId) {
  if (!p.lanes.includes(toLane)) throw new Error('bad lane')
  if (beforeId === id) return
  const md = ensureLanes(await readFile(p.backlog, 'utf8'), p.lanes)
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const idx = heads.findIndex((h) => h.text.startsWith(id + ' ·'))
  if (idx === -1) throw new Error('item not found')
  const start = heads[idx].i
  const end = idx + 1 < heads.length ? heads[idx + 1].i : lines.length
  const block = lines.slice(start, end)
  const rest = [...lines.slice(0, start), ...lines.slice(end)]
  const rheads = []
  rest.forEach((l, i) => { if (/^## /.test(l)) rheads.push({ i, text: l.slice(3).trim() }) })
  let insertAt
  if (beforeId) {
    const target = rheads.find((h) => h.text.startsWith(beforeId + ' ·'))
    if (!target) throw new Error('drop target not found')
    insertAt = target.i
  } else {
    const laneIdx = rheads.findIndex((h) => h.text === toLane)
    if (laneIdx === -1) throw new Error('lane not found')
    const nextLane = rheads.slice(laneIdx + 1).find((h) => p.lanes.includes(h.text))
    insertAt = nextLane ? nextLane.i : rest.length
  }
  const out = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
  await writeFile(p.backlog, out.join('\n'))
}

// Mint the next PREFIX number and append a template card to a lane.
// Optional fields fill the template's tbd slots; a Tags line is only
// written when tags are given, so title-only cards match the old template
// byte-for-byte.
async function newCard(p, title, lane, extra = {}) {
  if (!p.lanes.includes(lane)) throw new Error('bad lane')
  if (!title || !title.trim()) throw new Error('title required')
  const md = ensureLanes(await readFile(p.backlog, 'utf8'), p.lanes)
  let max = 0
  for (const m of md.matchAll(new RegExp(`^## ${p.config.prefix}-(\\d+)`, 'gm'))) max = Math.max(max, Number(m[1]))
  const id = `${p.config.prefix}-${String(max + 1).padStart(3, '0')}`
  const today = new Date().toISOString().slice(0, 10)
  const f = (v) => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim()) || null
  const tags = f(extra.tags)
  const block = `## ${id} · ${title.trim()}
- **Status:** open (carded ${today} via Autobahn)
- **Size:** ${f(extra.size) || 'tbd'}
${tags ? `- **Tags:** ${tags}\n` : ''}- **Why:** ${f(extra.why) || 'tbd'}
- **Spec:** ${f(extra.spec) || 'tbd'}
- **Done means:** ${f(extra.done) || 'tbd'}

`
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const laneIdx = heads.findIndex((h) => h.text === lane)
  if (laneIdx === -1) throw new Error('lane not found')
  const nextLane = heads.slice(laneIdx + 1).find((h) => p.lanes.includes(h.text))
  const insertAt = nextLane ? nextLane.i : lines.length
  const out = [...lines.slice(0, insertAt), ...block.split('\n'), ...lines.slice(insertAt)]
  await writeFile(p.backlog, out.join('\n'))
  return id
}

// Git awareness is scoped to the board file alone — the rest of the repo
// is none of Autobahn's business.
// Block / unblock: insert, replace, or remove the card's single
// `- **Blocked:** reason` line. Unblocking a legacy card whose Status line
// itself says "blocked …" rewrites that status to open — there is nothing
// older to restore.
async function setBlocked(p, id, reason) {
  const md = await readFile(p.backlog, 'utf8')
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const idx = heads.findIndex((h) => h.text.startsWith(id + ' ·'))
  if (idx === -1) throw new Error('item not found')
  const start = heads[idx].i
  const end = idx + 1 < heads.length ? heads[idx + 1].i : lines.length
  let bLine = -1, statusLine = -1
  for (let i = start + 1; i < end; i++) {
    if (bLine === -1 && /^\s*[-*] \*\*Blocked:\*\*/.test(lines[i])) bLine = i
    if (statusLine === -1 && /^\s*[-*] \*\*Status:\*\*/.test(lines[i])) statusLine = i
  }
  if (reason == null) {
    if (bLine !== -1) {
      lines.splice(bLine, 1)
      if (statusLine > bLine) statusLine--
    }
    if (statusLine !== -1 && /^\s*[-*] \*\*Status:\*\*\s*blocked/i.test(lines[statusLine])) {
      lines[statusLine] = `- **Status:** open (unblocked ${new Date().toISOString().slice(0, 10)} via Autobahn)`
    }
  } else {
    const entry = `- **Blocked:** ${String(reason).replace(/\s+/g, ' ').trim() || 'blocked'}`
    if (bLine !== -1) lines[bLine] = entry
    else lines.splice((statusLine !== -1 ? statusLine : start) + 1, 0, entry)
  }
  await writeFile(p.backlog, lines.join('\n'))
}

// Ship a card: rewrite its Status line (Shipped is derived from status, so
// the block itself stays where it sits in the file).
async function setShipped(p, id) {
  const md = await readFile(p.backlog, 'utf8')
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const idx = heads.findIndex((h) => h.text.startsWith(id + ' ·'))
  if (idx === -1) throw new Error('item not found')
  const start = heads[idx].i
  const end = idx + 1 < heads.length ? heads[idx + 1].i : lines.length
  const entry = `- **Status:** shipped (${new Date().toISOString().slice(0, 10)} via Autobahn)`
  let statusLine = -1
  for (let i = start + 1; i < end; i++) if (/^\s*[-*] \*\*Status:\*\*/.test(lines[i])) { statusLine = i; break }
  if (statusLine !== -1) lines[statusLine] = entry
  else lines.splice(start + 1, 0, entry)
  await writeFile(p.backlog, lines.join('\n'))
}

const gitDirty = (root, backlogName) => new Promise((res) => {
  execFile('git', ['-C', root, 'status', '--porcelain', '--', backlogName], (e, out) => res(e ? '' : out.trim()))
})
const gitRun = (root, args) => new Promise((res, rej) => {
  execFile('git', ['-C', root, ...args], (e, out, err) => e ? rej(new Error(String(err || e.message).trim())) : res(out))
})

// Commit subject from a structural diff of HEAD's board vs the working file:
// "backlog: TASK-007 carded · TASK-003 → Now · TASK-002 edited".
async function commitMessage(p) {
  const now = parseBacklog(await readFile(p.backlog, 'utf8'), p.lanes).items
  let before = []
  try { before = parseBacklog(await gitRun(p.root, ['show', `HEAD:./${p.config.backlog}`]), p.lanes).items } catch { /* new file */ }
  const was = new Map(before.map((i) => [i.id, i]))
  const is = new Map(now.map((i) => [i.id, i]))
  const parts = []
  for (const i of now) {
    const o = was.get(i.id)
    if (!o) parts.push(`${i.id} carded`)
    else if (o.lane !== i.lane) parts.push(`${i.id} → ${i.lane}`)
    else if (o.title !== i.title || o.body !== i.body) parts.push(`${i.id} edited`)
  }
  for (const o of before) if (!is.has(o.id)) parts.push(`${o.id} removed`)
  for (const lane of p.lanes) { // same cards, same lane, new order
    const stay = (list, other) => list.filter((i) => i.lane === lane && other.get(i.id)?.lane === lane).map((i) => i.id)
    if (stay(before, is).join() !== stay(now, was).join()) parts.push(`${lane} reordered`)
  }
  const list = parts.length > 6 ? [...parts.slice(0, 6), `+${parts.length - 6} more`] : parts
  return 'backlog: ' + (list.join(' · ') || 'update')
}

// Boards reachable under a directory (two levels), for the picker page.
async function findBoards(dir, depth) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    const sub = path.join(dir, e.name)
    if (await exists((await loadProject(sub)).backlog)) out.push(e.name)
    else if (depth > 1) out.push(...(await findBoards(sub, depth - 1)).map((b) => e.name + '/' + b))
  }
  return out.sort()
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Styled to match the board view (index.html): same palette, type, card chrome.
// A directory listing boards is a container — navigation only. "Start a
// board here" appears ONLY at a dead end (no boards below), where becoming
// a board is the page's only useful future.
const pickerHtml = (rel, boards) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Autobahn</title>
<style>
  html{color-scheme:dark}
  body{background:#050505;color:#DEDEDE;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif;font-synthesis:none;max-width:560px;margin:0 auto;padding:14vh 24px 96px}
  header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 4px}
  h1{font-size:30px;font-weight:400;letter-spacing:-0.015em;margin:0}
  h1 span{font-size:13px;color:#3B3D3D;margin-left:8px}
  form{margin:0}
  button{font-family:inherit;font-size:13.5px;color:#050505;background:#DEDEDE;border:0;border-radius:999px;padding:7px 15px;cursor:pointer}
  button:hover{background:#fff}
  input{font-family:inherit;font-size:13.5px;color:#DEDEDE;background:#111212;border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:7px 14px;outline:0;width:190px}
  input::placeholder{color:#3B3D3D}
  [hidden]{display:none}
  p.sub{font-size:13px;color:#3B3D3D;margin:0 0 22px}
  a{display:block;background:#111212;border-radius:10px;padding:12px 14px;margin:0 0 8px;color:#DEDEDE;text-decoration:none}
  a:hover{background:#161717}
  a small{display:block;font-size:12px;color:#969A9C}
  p.none{font-size:14px;color:#969A9C}
</style>
<header>
  <h1>Autobahn<span>/${escapeHtml(rel)}</span></h1>
  ${boards.length
    ? `<form method="post" action="api/init" id="nb" hidden><input name="name" placeholder="board name" autocomplete="off" spellcheck="false" required /></form>
       <button id="nb-btn">New board</button>`
    : '<form method="post" action="api/init"><button>Start a board here</button></form>'}
</header>
<p class="sub">boards</p>
${boards.length
    ? boards.map((b) => `<a href="${b.split('/').map(encodeURIComponent).join('/')}/">${escapeHtml(path.basename(b))}<small>${escapeHtml(b)}</small></a>`).join('\n')
    : '<p class="none">No board here yet — and none in the two levels below.</p>'}
<script>
  const nbBtn = document.getElementById('nb-btn'), nbForm = document.getElementById('nb')
  if (nbBtn) {
    const inp = nbForm.querySelector('input')
    nbBtn.onclick = () => { nbForm.hidden = false; nbBtn.hidden = true; inp.focus() }
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { nbForm.hidden = true; nbBtn.hidden = false } })
  }
</script>
`

// Live reload: one fs.watch per board directory (OS file events — no
// polling, no idle CPU), fanned out to open boards over server-sent
// events. The watcher exists only while someone is connected.
const watchers = new Map() // root -> { fsw, clients, timer, ping }
function subscribe(root, res) {
  let w = watchers.get(root)
  if (!w) {
    w = { clients: new Set(), timer: null, ping: null, fsw: null }
    try {
      w.fsw = watch(root, (event, file) => {
        if (!file || !(file.endsWith('.md') || file === 'autobahn.config.json')) return
        clearTimeout(w.timer) // editors write in bursts; coalesce
        w.timer = setTimeout(() => { for (const c of w.clients) c.write(`data: ${file}\n\n`) }, 80)
      })
    } catch { return }
    w.ping = setInterval(() => { for (const c of w.clients) c.write(': ping\n\n') }, 30000)
    watchers.set(root, w)
  }
  w.clients.add(res)
  res.on('close', () => {
    w.clients.delete(res)
    if (!w.clients.size) { w.fsw.close(); clearInterval(w.ping); clearTimeout(w.timer); watchers.delete(root) }
  })
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

const baseConfig = await readConfig(BASE)
const DOMAIN = domainArg !== undefined ? (domainArg || baseConfig.domain || 'autobahn.localhost') : (baseConfig.domain || null)
// $PORT lets a wrapping proxy (portless) hand us a port and own the domain.
const envPort = process.env.PORT ? Number(process.env.PORT) : undefined
const PORT = portArg ?? envPort ?? baseConfig.port ?? (DOMAIN ? 80 : 4780)

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    // Route = project directory under BASE; a trailing api/<endpoint> is the API.
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    let endpoint = null
    if (parts.length >= 2 && parts[parts.length - 2] === 'api') { endpoint = parts.pop(); parts.pop() }
    const dir = path.resolve(BASE, parts.join('/'))
    if (dir !== BASE && !dir.startsWith(BASE + path.sep)) return send(res, 404, { error: 'not found' })
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return send(res, 404, { error: 'not found' })
    const p = await loadProject(dir)
    const hasBoard = await exists(p.backlog)

    if (!endpoint) {
      // Trailing slash so index.html's relative api/ calls resolve to this board.
      if (parts.length && !url.pathname.endsWith('/')) {
        res.writeHead(302, { Location: url.pathname + '/' + url.search })
        return res.end()
      }
      if (hasBoard) return send(res, 200, await readFile(new URL('./index.html', import.meta.url), 'utf8'), 'text/html')
      return send(res, 200, pickerHtml(parts.join('/'), await findBoards(dir, 2)), 'text/html')
    }

    if (endpoint === 'boards') {
      // Every board under the served root, for the ⌘K switcher ('' = the root itself).
      const boards = await findBoards(BASE, 2)
      if (await exists((await loadProject(BASE)).backlog)) boards.unshift('')
      return send(res, 200, { base: path.basename(BASE), boards })
    }

    if (endpoint === 'init' && req.method === 'POST') {
      // Two creation paths: a dead end starts a board HERE (no name sent);
      // a container creates a board in a new named subfolder.
      let body = ''
      for await (const c of req) body += c
      const name = new URLSearchParams(body).get('name')
      const skeleton = (title, lanes) => `# ${title}\n${lanes.map((l) => `\n## ${l}\n`).join('')}`
      if (name !== null) {
        const clean = name.trim()
        if (!clean || /[/\\]/.test(clean) || clean.startsWith('.')) return send(res, 400, { error: 'bad name' })
        const sub = path.join(dir, clean)
        const subP = await loadProject(sub)
        if (await exists(subP.backlog)) return send(res, 400, { error: 'board already exists' })
        await mkdir(sub, { recursive: true })
        await writeFile(subP.backlog, skeleton(clean, subP.lanes))
        res.writeHead(303, { Location: '/' + [...parts, clean].map(encodeURIComponent).join('/') + '/' })
        return res.end()
      }
      if (hasBoard) return send(res, 400, { error: 'board already exists' })
      await writeFile(p.backlog, skeleton(path.basename(dir), p.lanes))
      res.writeHead(303, { Location: '/' + parts.map(encodeURIComponent).join('/') + (parts.length ? '/' : '') })
      return res.end()
    }

    if (!hasBoard) return send(res, 404, { error: 'no board at this route' })
    if (endpoint === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      subscribe(p.root, res)
      return // stream stays open until the tab goes away
    }
    if (endpoint === 'board') {
      const md = await readFile(p.backlog, 'utf8')
      return send(res, 200, {
        ...parseBacklog(md, p.lanes),
        docs: await listDocs(p),
        lanes: p.lanes,
        prefix: p.config.prefix,
        backlog: p.config.backlog,
        root: path.basename(p.root),
        dirty: await gitDirty(p.root, p.config.backlog),
      })
    }
    if (endpoint === 'doc') {
      const name = url.searchParams.get('name')
      const docs = await listDocs(p)
      if (!docs.includes(name) && name !== p.config.backlog) return send(res, 400, { error: 'unknown doc' })
      return send(res, 200, await readFile(path.join(p.root, name), 'utf8'), 'text/plain; charset=utf-8')
    }
    if (endpoint === 'commit') {
      // GET previews the generated message; POST stages and commits the
      // board file — only ever the board file, never the rest of the repo.
      if (!(await gitDirty(p.root, p.config.backlog))) return send(res, 400, { error: 'board file is clean' })
      const message = await commitMessage(p)
      if (req.method !== 'POST') return send(res, 200, { message })
      await gitRun(p.root, ['add', '--', p.config.backlog])
      await gitRun(p.root, ['commit', '-m', message, '--', p.config.backlog])
      const sha = (await gitRun(p.root, ['rev-parse', '--short', 'HEAD'])).trim()
      return send(res, 200, { ok: true, sha, message })
    }
    if (endpoint === 'move' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { id, toLane, beforeId } = JSON.parse(body)
      await moveItem(p, id, toLane, beforeId)
      return send(res, 200, { ok: true })
    }
    if (endpoint === 'ship' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      await setShipped(p, JSON.parse(body).id)
      return send(res, 200, { ok: true })
    }
    if (endpoint === 'block' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { id, reason } = JSON.parse(body)
      await setBlocked(p, id, reason ?? null)
      return send(res, 200, { ok: true })
    }
    if (endpoint === 'new' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const card = JSON.parse(body)
      const id = await newCard(p, card.title, card.lane || p.lanes[1] || p.lanes[0], card)
      return send(res, 200, { ok: true, id })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e.message || e) })
  }
})

let port = PORT
const announce = () => {
  const origin = process.env.PORTLESS_URL || `http://${DOMAIN || 'localhost'}${port === 80 ? '' : `:${port}`}/`
  console.log(`Autobahn → ${origin}  (root: ${BASE})`)
}

server.on('error', (e) => {
  // Port 80 is often root-only (macOS loopback binds) or already claimed
  // (Docker, nginx). Domain mode still works with a port — fall back.
  if (DOMAIN && port === 80 && (e.code === 'EACCES' || e.code === 'EADDRINUSE')) {
    const why = e.code === 'EACCES' ? 'needs elevated permissions here' : 'is already in use'
    console.error(`Port 80 ${why} — serving on :4780 instead (run with sudo, or free port 80, for a portless URL).`)
    port = 4780
    return server.listen(port, '127.0.0.1') // announce is still registered from the first listen
  }
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use — pass --port to pick another.`)
  else if (e.code === 'EACCES') console.error(`No permission to bind port ${port} — pass --port 8080 (or run with sudo).`)
  else console.error(e)
  process.exit(1)
})

// Domain mode binds loopback only: *.localhost names resolve to 127.0.0.1
// in browsers (and modern macOS), and there is no auth to hide behind.
server.listen(port, DOMAIN || envPort !== undefined ? '127.0.0.1' : undefined, announce)
