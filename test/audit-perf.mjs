/**
 * Performance audit — read-only, reproducible.
 *
 * Measures the hot path this package actually owns: the `interruption` fold over
 * REAL stored session logs, and what a reference-stable wire view saves.
 *
 * The claim being tested is the one in `index.js`: without a stable view, every
 * `step/start` and `step/end` publishes, and a publish costs a Host control-stream
 * frame, a Client store write, a whole Session-list snapshot rebuild and a
 * re-render of the open conversation.
 *
 * Nothing is written; the corpus is only read.
 *
 * usage: node audit-perf.mjs [sessionRoot]
 *
 * @module test/audit-perf
 */
import { performance } from 'node:perf_hooks'
import { initialState, foldInterruption, wireInterruption } from '../index.js'
import { listSessionDirs, readSessionEvents, sessionsRoot } from './session-log.mjs'

const root = process.argv[2] ?? sessionsRoot()

let dirs
try {
  dirs = process.argv[2] === undefined ? listSessionDirs() : [{ dir: process.argv[2], workspace: '', name: process.argv[2] }]
} catch (error) {
  console.log(`cannot list sessions under ${root}: ${error.message}`)
  process.exit(0)
}

const logs = []
for (const row of dirs) {
  try {
    const events = readSessionEvents(row.dir)
    if (events.length > 0) logs.push({ name: row.name ?? row.dir, events })
  } catch {
    // Unreadable session: not this audit's subject.
  }
}

if (logs.length === 0) {
  console.log(`no readable session log under ${root}`)
  console.log('pass a session directory: node audit-perf.mjs <sessionDir>')
  process.exit(0)
}

const totalEvents = logs.reduce((sum, log) => sum + log.events.length, 0)
const steps = logs.reduce(
  (sum, log) => sum + log.events.filter((event) => event.type === 'step/start' || event.type === 'step/end').length,
  0,
)
const turns = logs.reduce((sum, log) => sum + log.events.filter((event) => event.type === 'turn/start').length, 0)

console.log('-- corpus')
console.log(`  sessions ${logs.length}  events ${totalEvents}  turns ${turns}  step events ${steps}`)

// ---------------------------------------------------------------------------
// 1. Publish cost: identity view vs. reference-stable view.
// ---------------------------------------------------------------------------
/** The fields a Client renders. Anything else is host-only bookkeeping. */
const WIRE_FIELDS = ['status', 'turn', 'reason', 'abortCause', 'errorCode', 'errorMessage', 'partialMessage', 'todos']

/** Whether two states differ in any field the wire carries. */
function wireChanged(previous, next) {
  if (previous === undefined) return true
  return WIRE_FIELDS.some((field) => previous[field] !== next[field])
}

let identityPublications = 0
let stablePublications = 0
/** Events that genuinely change something a Client renders. */
let wireChanges = 0
let state
let previous
let previousIdentity
let previousStable

const started = performance.now()
for (const log of logs) {
  state = initialState()
  previous = undefined
  previousIdentity = undefined
  previousStable = undefined
  for (const event of log.events) {
    state = foldInterruption(state, event)
    if (wireChanged(previous, state)) wireChanges++
    previous = state
    // What an IDENTITY view would publish: a fresh object per fold.
    const identityView = { status: state.status, turn: state.turn, todos: state.todos }
    if (!Object.is(previousIdentity, identityView)) identityPublications++
    previousIdentity = identityView
    // What the shipped view publishes.
    const stableView = wireInterruption(state)
    if (!Object.is(previousStable, stableView)) stablePublications++
    previousStable = stableView
  }
}
const elapsed = performance.now() - started

const suppressed = identityPublications - stablePublications
console.log('\n-- publish cost')
console.log(`  identity view would publish   ${identityPublications}`)
console.log(`  the shipped view publishes    ${stablePublications}`)
console.log(`  suppressed                    ${suppressed} (${((suppressed / Math.max(1, identityPublications)) * 100).toFixed(1)}%)`)
console.log(`  fold cost                     ${elapsed.toFixed(1)} ms for ${totalEvents} events (${(elapsed / Math.max(1, totalEvents) * 1000).toFixed(1)} µs/event)`)
console.log(`  step events that must NOT publish: ${steps}`)

// The audit is a measurement, but one number is a CONTRACT: the wire must publish
// exactly when a wire field changes — no more (that would mean host-only
// bookkeeping is leaking into the wire) and no fewer (that would mean a change a
// Client renders was swallowed).
console.log(`  events that change a wire field ${wireChanges}`)
if (stablePublications !== wireChanges) {
  console.log(`\nFAIL: ${stablePublications} publications for ${wireChanges} wire-changing events`)
  console.log('      the wire view is not reference-stable, or it swallowed a visible change')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Wire payload size.
// ---------------------------------------------------------------------------
let maxBytes = 0
let totalBytes = 0
for (const log of logs) {
  state = initialState()
  for (const event of log.events) state = foldInterruption(state, event)
  const bytes = Buffer.byteLength(JSON.stringify(wireInterruption(state)))
  totalBytes += bytes
  maxBytes = Math.max(maxBytes, bytes)
}
console.log('\n-- wire payload')
console.log(`  largest view                  ${maxBytes} B`)
console.log(`  mean view                     ${(totalBytes / logs.length).toFixed(0)} B`)

console.log('\nOK: publish-cost contract holds')
