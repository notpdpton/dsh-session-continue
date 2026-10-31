/**
 * Test the discriminator that separates a deliberate in-process Stop from an
 * interruption caused by a page refresh / app restart.
 *
 * Both write `turn/end { kind: 'aborted', reason: { kind: 'user' } }`, so the
 * cause alone cannot tell them apart. A deliberate Stop pressed while the model
 * is streaming also marks the partial assistant message `interrupted: true`; a
 * turn killed between steps (shutdown, reconnect) leaves no such message.
 *
 * usage: node explain-aborts.mjs <sessionDir> [...more]
 */
import { readSessionEvents, resolveSessionDir } from './session-log.mjs'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('usage: node explain-aborts.mjs <sessionDirOrId> [...]')
  process.exit(2)
}

for (const arg of args) {
  const dir = resolveSessionDir(arg)
  let events
  try {
    events = readSessionEvents(dir)
  } catch (error) {
    console.log(`\n== ${arg}: ${error.message}`)
    continue
  }
  const name = dir.split(/[\\/]/).filter(Boolean).at(-1)
  console.log(`\n== ${name} (${events.length} events)`)

  // Walk the log turn by turn, tracking whether a partial assistant message was
  // marked interrupted before the turn closed.
  let partialInTurn = false
  const rows = []
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event.type === 'turn/start') {
      partialInTurn = false
    } else if (event.type === 'assistant/message') {
      if (event.data?.interrupted === true) partialInTurn = true
    } else if (event.type === 'turn/end') {
      const reason = event.data.reason ?? {}
      // A `session/end-seed` shortly AFTER the close is the shutdown signature.
      const later = events.slice(index + 1, index + 12).filter((e) => e.type === 'session/end-seed')
      rows.push({
        turn: event.data.turn,
        kind: reason.kind,
        cause: reason.reason?.kind ?? '',
        partial: partialInTurn,
        endSeedSoon: later.length > 0,
        at: event.time,
      })
    }
  }

  for (const row of rows) {
    const verdict =
      row.kind === 'aborted'
        ? row.partial
          ? 'deliberate Stop (a partial assistant message was on record)'
          : 'NO partial message -> shutdown / reconnect interruption'
        : row.kind
    const stamp = new Date(row.at + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
    console.log(
      `  turn ${row.turn} @ ${stamp}: kind=${row.kind}${row.cause ? `/${row.cause}` : ''} partial=${row.partial} endSeedSoon=${row.endSeedSoon}  => ${verdict}`,
    )
  }

  const starts = events.filter((event) => event.type === 'turn/start').length
  const ends = events.filter((event) => event.type === 'turn/end').length
  if (starts > ends) console.log(`  open tail: turn ${starts} never closed (true crash)`)
}
