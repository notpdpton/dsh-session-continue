/**
 * Verify the `interruption` fold against REAL stored session logs.
 *
 * Read-only: it never writes to the sessions directory. Two readings of the same
 * log are compared, because the client sees both:
 *
 *   1. the stored prefix, folded as-is      -> 'crash'        (live/attached read)
 *   2. the prefix + interrupted closers     -> 'interrupted'  (cold read)
 *
 * With no log given it scans the sessions root and reports how many sessions each
 * classification covers. With no corpus at all it says so and exits 0 — a machine
 * without sessions is not a failing build, it is an untested one, and pretending
 * otherwise would be the exact dishonesty a green check invites.
 *
 * usage: node verify-fold.mjs [sessionDir ...]
 */
import { initialState, foldInterruption, interruptionStateSchema } from '../index.js'
import { listSessionDirs, readSessionEvents, resolveSessionDir, sessionsRoot } from './session-log.mjs'

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Fold a whole log through the shipped implementation. */
function foldLog(events) {
  let state = initialState()
  for (const event of events) {
    state = foldInterruption(state, event)
    interruptionStateSchema.parse(state)
  }
  return state
}

/**
 * The harness's own crash-repair closers.
 *
 * A cold read of a crashed log has its open tail closed with synthetic
 * `turn/end { kind: 'interrupted' }` events before any projection sees it. This
 * reproduces that, so the cold-read classification can be checked too.
 */
function interruptedClosers(events) {
  let openTurn = null
  let openStep = null
  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = event.data.turn
      openStep = null
    } else if (event.type === 'step/start') {
      openStep = event.data.step
    } else if (event.type === 'step/end') {
      openStep = null
    } else if (event.type === 'turn/end') {
      openTurn = null
      openStep = null
    }
  }
  const closers = []
  if (openTurn === null) return closers
  if (openStep !== null) closers.push({ type: 'step/end', data: { turn: openTurn, step: openStep } })
  closers.push({ type: 'turn/end', data: { turn: openTurn, reason: { kind: 'interrupted' } } })
  return closers
}

let dirs = process.argv.slice(2).map(resolveSessionDir)
if (dirs.length === 0) {
  try {
    dirs = listSessionDirs().map((row) => row.dir)
  } catch {
    dirs = []
  }
}

if (dirs.length === 0) {
  console.log(`no stored session found under ${sessionsRoot()}`)
  console.log('pass a session directory to test the fold against a real log:')
  console.log('  node verify-fold.mjs <sessionDir>')
  process.exit(0)
}

console.log(`-- folding ${dirs.length} stored session(s)`)
const tally = new Map()
let readable = 0
for (const dir of dirs) {
  let events
  try {
    events = readSessionEvents(dir)
  } catch {
    continue
  }
  readable++
  const name = dir.split(/[\\/]/).filter(Boolean).at(-1)

  const live = foldLog(events)
  const cold = foldLog([...events, ...interruptedClosers(events)])
  tally.set(cold.status, (tally.get(cold.status) ?? 0) + 1)

  // The two readings must always agree on whether the user is owed a notice,
  // because the same Session is read both ways depending on how it is opened.
  const liveShows = live.status !== 'none'
  const coldShows = cold.status !== 'none'
  check(`${name}: both readings agree on showing the notice`, liveShows === coldShows, `live=${live.status} cold=${cold.status}`)

  // A cold read must never be 'crash': the repair marker balances the log.
  check(`${name}: the cold reading is not 'crash'`, cold.status !== 'crash', cold.status)

  // The fold must be plain JSON at every step, because it lands in a checkpoint.
  const round = JSON.parse(JSON.stringify(cold))
  check(`${name}: the folded state round-trips through JSON`, JSON.stringify(round) === JSON.stringify(cold))

  // Todos always carry a known status and a bounded text.
  check(
    `${name}: every todo carries a known status`,
    cold.todos.every((todo) => todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'completed'),
    JSON.stringify(cold.todos.map((todo) => todo.status)),
  )
}

console.log(`\nreadable logs: ${readable}/${dirs.length}`)
console.log('classification (cold read):')
for (const [status, count] of [...tally.entries()].sort()) console.log(`  ${status}: ${count}`)

console.log(failures === 0 ? '\nOK: interruption fold matches real logs' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
