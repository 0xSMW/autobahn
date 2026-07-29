import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
assert.ok(script, 'index.html contains an inline script')

const rendererStart = script.indexOf('function esc(')
const rendererEnd = script.indexOf('async function render(')
const fieldsStart = script.indexOf('function parseFields(')
const fieldsEnd = script.indexOf('const TBD_RE')
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'renderer source is extractable')
assert.ok(fieldsStart >= 0 && fieldsEnd > fieldsStart, 'field parser source is extractable')

const { md, parseFields } = new Function(
  `${script.slice(rendererStart, rendererEnd)}
   ${script.slice(fieldsStart, fieldsEnd)}
   return { md, parseFields }`
)()

test('preserves Markdown blocks inside structured card fields', () => {
  const body = `- **Status:** in progress
- **Spec:** Redesign around two outcomes:
  1. Keep the document as stable context and give every state one
     obvious next action.
  2. Cover recovery paths.
     - [x] Crash recovery
     - [ ] Conflict recovery
- **Done means:** The complete workflow is usable.

### Notes
Ordinary body Markdown remains outside the fields.`

  const { fields, rest } = parseFields(body)
  const spec = fields.find(([name]) => name === 'Spec')?.[1]

  assert.equal(fields.length, 3)
  assert.equal(spec, `Redesign around two outcomes:
1. Keep the document as stable context and give every state one
   obvious next action.
2. Cover recovery paths.
   - [x] Crash recovery
   - [ ] Conflict recovery`)
  assert.match(rest, /^### Notes/)

  const rendered = md(spec)
  assert.match(rendered, /<p>Redesign around two outcomes:<\/p>/)
  assert.match(rendered, /<ol>/)
  assert.match(rendered, /<li>Keep the document as stable context and give every state one obvious next action\.\s*<\/li>/)
  assert.match(rendered, /<li>Cover recovery paths\.\s*<ul>/)
  assert.match(rendered, /type="checkbox" disabled checked/)
  assert.match(rendered, /type="checkbox" disabled>/)
})

test('renders richer block and inline Markdown safely', () => {
  const rendered = md(`> A quoted
> paragraph.

~~~js
const answer = 42
~~~

~~retired~~ [safe](https://example.com/?one=1&two=2) [unsafe](javascript:alert(1))

![Diagram](./diagram.png "Workflow")`)

  assert.match(rendered, /<blockquote><p>A quoted paragraph\.<\/p><\/blockquote>/)
  assert.match(rendered, /<code class="language-js">const answer = 42<\/code>/)
  assert.match(rendered, /<del>retired<\/del>/)
  assert.match(rendered, /href="https:\/\/example\.com\/\?one=1&amp;two=2"/)
  assert.match(rendered, /href="#"/)
  assert.match(rendered, /<img src="\.\/diagram\.png" alt="Diagram" title="Workflow" loading="lazy">/)
})

test('honors ordered-list starts and preserves ordinary hard wraps', () => {
  const rendered = md(`3. Third item
4. Fourth item

This paragraph is hard
wrapped across lines.`)

  assert.match(rendered, /<ol start="3">/)
  assert.match(rendered, /<li>Third item\s*<\/li>/)
  assert.match(rendered, /<p>This paragraph is hard wrapped across lines\.<\/p>/)
})
