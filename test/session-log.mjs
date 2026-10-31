/**
 * Reading stored Session logs.
 *
 * Shared by every diagnostic script in this directory so the frame walk and the
 * directory resolution exist once. Read-only: nothing here writes.
 *
 * A JSONL session backend appends one zstd FRAME per flush, so a whole log is
 * many concatenated frames and Node's `zstdDecompressSync` decodes only the
 * first. The walk below splits on the frame magic instead.
 *
 * @module test/session-log
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** zstd frame magic (little-endian 0xFD2FB528). */
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** The DSH home directory: `$DSH_HOME`, else `~/.dsh`. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** The root that holds `<workspace>/<session>/session.v4.jsonl.zstd`. */
export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/**
 * Resolve one command-line argument to a session directory.
 *
 * An argument containing a separator is a path and is taken as given; anything
 * else is a session id under the sessions root.
 *
 * @param arg - a session directory or a bare session id.
 * @returns the directory path.
 */
export function resolveSessionDir(arg) {
  if (arg.includes('/') || arg.includes('\\')) return arg
  return join(sessionsRoot(), arg)
}

/** Split a buffer into concatenated zstd frames. */
function splitFrames(buffer) {
  const starts = []
  for (let index = 0; index + 4 <= buffer.length; index++) {
    if (
      buffer[index] === MAGIC[0] &&
      buffer[index + 1] === MAGIC[1] &&
      buffer[index + 2] === MAGIC[2] &&
      buffer[index + 3] === MAGIC[3]
    ) {
      starts.push(index)
    }
  }
  const frames = []
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index]
    const to = index + 1 < starts.length ? starts[index + 1] : buffer.length
    frames.push(buffer.subarray(from, to))
  }
  return frames
}

/**
 * Decode every event of one stored session log.
 *
 * A frame that fails to decompress is skipped rather than aborting the read: a
 * truncated tail is exactly what a crashed session looks like, and the events
 * that DID land are the ones a diagnosis needs.
 *
 * @param dir - session directory.
 * @returns the committed events, in order.
 */
export function readSessionEvents(dir) {
  const raw = readFileSync(join(dir, 'session.v4.jsonl.zstd'))
  const parts = []
  for (const frame of splitFrames(raw)) {
    try {
      parts.push(zstdDecompressSync(frame).toString('utf8'))
    } catch {
      // A torn frame: keep everything that decoded.
    }
  }
  return parts
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/**
 * List every stored session directory under the sessions root.
 *
 * @returns `{ workspace, name, dir }` rows; unreadable entries are skipped.
 */
export function listSessionDirs() {
  const root = sessionsRoot()
  const rows = []
  for (const workspace of readdirSync(root)) {
    const workspaceDir = join(root, workspace)
    let entries
    try {
      entries = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const name of entries) rows.push({ workspace, name, dir: join(workspaceDir, name) })
  }
  return rows
}
