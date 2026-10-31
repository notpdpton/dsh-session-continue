/**
 * Dump the turn/step/message skeleton of one stored Session log, so a
 * classification can be explained event by event.
 *
 * usage: node dump-session.mjs <sessionDirOrId> [more...]
 */
import { readSessionEvents, resolveSessionDir } from './session-log.mjs'

/** One-line summary of an event payload. */
function summarize(data) {
  if (data === undefined || data === null) return ''
  if (typeof data.reason === 'object' && data.reason !== null && 'kind' in data.reason) {
    return `reason=${JSON.stringify(data.reason)}`
  }
  if ('turn' in data && 'step' in data) return `turn=${data.turn} step=${data.step}`
  if ('turn' in data) return `turn=${data.turn}`
  if (data.interrupted === true) return 'interrupted=true'
  if (Array.isArray(data.todos)) return `todos=${data.todos.length}`
  const text = JSON.stringify(data)
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

/** Whether an event type belongs in the skeleton. */
function interesting(type) {
  return (
    type.startsWith('turn/') ||
    type.startsWith('step/') ||
    type.startsWith('session/') ||
    type === 'user/message' ||
    type === 'assistant/message' ||
    type === 'todo/write' ||
    type === 'tool/call' ||
    type === 'tool/result'
  )
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('usage: node dump-session.mjs <sessionDirOrId> [...]')
  process.exit(2)
}

for (const arg of args) {
  const dir = resolveSessionDir(arg)
  let events
  try {
    events = readSessionEvents(dir)
  } catch (error) {
    console.log(`\n== ${arg}: cannot read — ${error.message}`)
    continue
  }
  console.log(`\n===== ${dir.split(/[\\/]/).filter(Boolean).at(-1)} (${events.length} events)`)
  events.forEach((event, index) => {
    if (!interesting(event.type)) return
    let line = `  #${String(index).padStart(4)} ${event.type}`
    if (event.type === 'user/message') {
      const text = event.data?.content?.map?.((part) => part.text ?? '').join('') ?? ''
      line += ` "${text.slice(0, 90).replace(/\n/g, ' ')}"`
    } else if (event.type === 'assistant/message') {
      line += ` interrupted=${event.data?.interrupted === true}`
    } else {
      line += ` ${summarize(event.data)}`
    }
    console.log(line)
  })
}
