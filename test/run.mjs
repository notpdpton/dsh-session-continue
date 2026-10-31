/**
 * Run every mandatory offline check in this directory.
 *
 * The session-log diagnostics are NOT part of this run: they need a real session
 * directory and are exploratory. Everything selected here is self-contained, needs
 * no dependency, needs no network, and must pass on a clean checkout.
 *
 * Each check runs in its own process, because several of them install a
 * `window`/`localStorage` shim before importing the shipped browser half.
 *
 * usage: node test/run.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Every mandatory check, in the order they narrow from packaging to behaviour. */
const CHECKS = [
  ['verify-manifest.mjs', 'manifest, exports, patch, locales, icon, identity hygiene'],
  ['verify-resolve.mjs', 'every resource the Host resolves for this package'],
  ['verify-metadata.mjs', 'the plugin manager display-metadata reader'],
  ['verify-client.mjs', 'slot registrations, dictionaries, notice render decisions'],
  ['verify-layout.mjs', 'the notice layout rules'],
  ['verify-continue.mjs', 'the Continue action and the preference switches'],
  ['verify-icons.mjs', 'icon structure, self-containment, palette, geometry'],
]

const results = []
for (const [file, what] of CHECKS) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  const ms = Date.now() - started
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const ok = run.status === 0
  results.push({ file, what, ok, ms, output })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(22)} ${String(ms).padStart(5)} ms  ${what}`)
  if (!ok) console.log(output.split('\n').filter((line) => line.includes('FAIL') || line.startsWith('file://')).join('\n'))
}

const failed = results.filter((result) => !result.ok)
console.log('')
if (failed.length === 0) {
  console.log(`OK: ${results.length}/${results.length} checks pass`)
  process.exit(0)
}
console.log(`FAIL: ${failed.length}/${results.length} checks failed — ${failed.map((result) => result.file).join(', ')}`)
process.exit(1)
