/**
 * Explain one stored Session's interruption classification, and WHY the Continue
 * button does or does not appear for it.
 *
 * This is the diagnostic for "I expected the button but did not see it": it reads
 * the real log and prints the fold result plus the exact rule that decides the
 * Client's answer.
 *
 * usage: node explain-session.mjs <sessionDirOrId> [...more]
 */
import { initialState, foldInterruption } from '../index.js'
import { readSessionEvents, resolveSessionDir } from './session-log.mjs'

/**
 * The Client's decision, mirrored from `describeInterruption` in client.js.
 *
 * Kept as a mirror rather than imported: client.js is a browser module table
 * registration, not an importable module. `verify-client.mjs` is what pins the
 * two implementations together.
 */
function clientDecision(state, { notifyUserAbort = true } = {}) {
  switch (state.status) {
    case 'crash':
      return { show: true, rule: 'the tail turn never closed (process died)' }
    case 'interrupted':
      return { show: true, rule: 'the harness repair marker, or a turn killed between steps' }
    case 'error':
      return { show: true, rule: 'the turn failed' }
    case 'max-tokens':
      return { show: true, rule: 'the turn hit its output limit' }
    case 'blocked':
      return { show: true, rule: 'the turn was blocked' }
    case 'aborted':
      return notifyUserAbort
        ? { show: true, rule: 'you stopped it yourself (partial message on record)' }
        : { show: false, rule: 'you stopped it yourself, and the preference hides those' }
    default:
      return { show: false, rule: 'no interruption recorded' }
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('usage: node explain-session.mjs <sessionDirOrId> [...]')
  process.exit(2)
}

for (const arg of args) {
  const dir = resolveSessionDir(arg)
  let events
  try {
    events = readSessionEvents(dir)
  } catch (error) {
    console.log(`\n== ${arg}\n  cannot read: ${error.message}`)
    continue
  }

  let state = initialState()
  for (const event of events) state = foldInterruption(state, event)

  const starts = events.filter((event) => event.type === 'turn/start').length
  const ends = events.filter((event) => event.type === 'turn/end').length
  const lastEnd = [...events].reverse().find((event) => event.type === 'turn/end')
  const partial = events.filter((event) => event.type === 'assistant/message' && event.data?.interrupted === true)
  const lastEvent = events.at(-1)
  const name = dir.split(/[\\/]/).filter(Boolean).at(-1)
  const decision = clientDecision(state)

  console.log(
    [
      `\n== ${name}`,
      `  events=${events.length}  turn/start=${starts} turn/end=${ends}  openTail=${starts > ends}`,
      `  last turn/end: ${lastEnd === undefined ? 'none' : JSON.stringify(lastEnd.data.reason)}`,
      `  partial assistant messages (interrupted:true): ${partial.length}`,
      `  last event: ${lastEvent?.type} @ ${new Date(lastEvent?.time ?? 0).toISOString()}`,
      `  fold => status=${state.status} turn=${state.turn} reason=${state.reason} abortCause=${state.abortCause} todos=${state.todos.length}`,
      `  CLIENT: ${decision.show ? 'SHOWS the Continue button' : 'HIDES the button'} — ${decision.rule}`,
    ].join('\n'),
  )
  if (decision.show) {
    const unfinished = state.todos.filter((todo) => todo.status !== 'completed')
    console.log(`  continue message attaches: turn line=${state.turn > 0}, todos=${unfinished.length} unfinished of ${state.todos.length}`)
  }
}
