# Example backlog

A starter backlog in the Autobahn grammar — see FORMAT.md in the repo root.
Run `node server.mjs example` and drag things around; this file rewrites.

## Now

## Sprint — this week
One goal: get the demo deployable. Everything else is a distraction until
`TASK-001` and `TASK-002` are done.

## TASK-001 · Wire up the deploy pipeline
- **Status:** open (blocked on: choosing a host)
- **Size:** M
- **Tags:** infra
- **Why:** every merge currently requires a manual upload; that's how stale
  demos happen.
- **Spec:** push to main deploys automatically; a bad deploy is one revert
  away from fixed.
- **Done means:** a merged PR is live within two minutes, no hands.

## TASK-002 · Empty states for every screen
- **Status:** open
- **Size:** S
- **Tags:** design
- **Why:** first-run users see blank panels and assume the app is broken.
- **Spec:** each screen gets one sentence of guidance and one action.
- **Done means:** a fresh account can navigate everywhere without confusion.

## Next

## TASK-003 · Import from CSV
- **Status:** open (spec drafted, needs a review)
- **Size:** L
- **Tags:** growth
- **Why:** every trial user asks for it in the first ten minutes.
- **Spec:** upload → column mapping UI → dry-run preview → import with a
  downloadable error report.
- **Done means:** a 10k-row file imports cleanly; bad rows are explained.

## Later

## TASK-006 · Public API
- **Status:** shipped 2026-07-01 — v1 with read endpoints and API keys
- **Size:** XL
- **Tags:** platform
- **Why:** integrations are the retention story.
- **Done means:** a third party builds something we didn't anticipate.

## TASK-005 · Dark mode
- **Status:** open
- **Size:** M
- **Tags:** design
- **Why:** requested often; also the default look of every screenshot that
  gets shared.

## TASK-004 · Keyboard shortcuts
- **Status:** blocked (on: TASK-002 — shortcuts need somewhere to point)
- **Size:** S
- **Why:** power users live on the keyboard; parity is table stakes.
