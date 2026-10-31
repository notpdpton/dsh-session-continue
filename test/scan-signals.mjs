/**
 * Scan every stored Session for the signals used to distinguish a deliberate Stop
 * from a shutdown abort, so the discriminator is validated against real data
 * rather than assumed.
 *
 * usage: node scan-signals.mjs
 */
import { readSessionEvents, listSessionDirs } from './session-log.mjs'

let partialTotal = 0
const abortedSamples = []
let scanned = 0

for (const row of listSessionDirs()) {
  let events
  try {
    events = readSessionEvents(row.dir)
  } catch {
    continue
  }
  scanned++
  partialTotal += events.filter((event) => event.type === 'assistant/message' && event.data?.interrupted === true).length

  let partial = false
  for (const event of events) {
    if (event.type === 'turn/start') partial = false
    else if (event.type === 'assistant/message' && event.data?.interrupted === true) partial = true
    else if (event.type === 'turn/end') {
      const reason = event.data.reason ?? {}
      if (reason.kind === 'aborted') {
        abortedSamples.push({
          session: `${row.workspace}/${row.name}`,
          turn: event.data.turn,
          cause: reason.reason?.kind ?? '',
          partial,
          at: event.time,
        })
      }
    }
  }
}

console.log(`sessions scanned = ${scanned}`)
console.log(`assistant messages flagged interrupted:true across ALL sessions = ${partialTotal}`)
console.log(`aborted turns = ${abortedSamples.length}`)
const withPartial = abortedSamples.filter((sample) => sample.partial)
console.log(`  of those, carrying a partial interrupted message = ${withPartial.length}`)
for (const sample of abortedSamples) {
  const stamp = new Date(sample.at + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
  console.log(`  ${stamp}  ${sample.session} turn ${sample.turn}  cause=${sample.cause}  partial=${sample.partial}`)
}
if (scanned === 0) {
  console.log('\nNOTE: no stored session was readable, so the discriminator has no data to')
  console.log('confirm against on this machine. That is a statement about the corpus, not')
  console.log('about the rule.')
} else if (withPartial.length === 0) {
  console.log('\nNOTE: no deliberate-Stop sample exists in this corpus, so the partialMessage')
  console.log('discriminator has no positive case to confirm against — only the absence')
  console.log('pattern (shutdown aborts) is observed.')
}
