/**
 * Audit every resource the Host resolves for this package at mount time.
 *
 * The Host resolves three separate things per Loader row and they can fail
 * independently:
 *   - the entry module itself       (`<name>` and `<name>/index.js`)
 *   - the browser half              (`<name>/client`, gated by `dsh.client`)
 *   - display metadata              (`<name>/locale/*.json`, `<name>/icon`, `<name>/package.json`)
 *
 * All of them go through Node's package `exports` resolution, so a map entry that
 * covers one and misses another breaks the plugin in a way no plain JSON check
 * notices. This script resolves each one exactly the way the Host does.
 *
 * It resolves through the package's own name, which Node supports for a package
 * that declares `exports` — no profile install is needed to run this audit.
 *
 * usage: node verify-resolve.mjs
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const name = pkg.name
const require = createRequire(root)

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Resolve one specifier through the package exports, or return the error code. */
function resolve(specifier) {
  try {
    return require.resolve(specifier)
  } catch (error) {
    return { error: error.code ?? String(error) }
  }
}

console.log('-- host resolution')
const entry = resolve(name)
check('the package entry resolves', typeof entry === 'string' && existsSync(entry), JSON.stringify(entry))
const entryAlias = resolve(`${name}/index.js`)
check('the explicit /index.js alias resolves to the same file', typeof entryAlias === 'string' && entryAlias === entry, JSON.stringify(entryAlias))

const client = resolve(`${name}/client`)
check('the browser half resolves', typeof client === 'string' && existsSync(client), JSON.stringify(client))
check('the browser half is the file the manifest promises', typeof client === 'string' && client.endsWith('client.js'), String(client))
check('the browser half is declared in dsh.client', pkg.dsh?.client !== undefined, JSON.stringify(pkg.dsh))

const manifest = resolve(`${name}/package.json`)
check('package.json is resolvable (the metadata reader needs it)', typeof manifest === 'string' && existsSync(manifest), JSON.stringify(manifest))

const icon = resolve(`${name}/icon`)
check('the icon resolves', typeof icon === 'string' && existsSync(icon), JSON.stringify(icon))

for (const locale of ['zh', 'en']) {
  const path = resolve(`${name}/locale/${locale}.json`)
  check(`locale/${locale}.json resolves`, typeof path === 'string' && existsSync(path), JSON.stringify(path))
}

console.log('\n-- escape hatches')
// The exports map is a whitelist: anything outside it must NOT resolve, or the
// package leaks internals (test scripts, sources) into the Host's resolution.
for (const specifier of [`${name}/test/verify-manifest.mjs`, `${name}/docs/design.md`, `${name}/README.md`]) {
  const result = resolve(specifier)
  check(`${specifier.replace(name + '/', '')} is not exported`, typeof result !== 'string', String(result))
}

console.log('\n-- module shapes')
const host = await import(new URL('index.js', root).href)
check('the entry module exports apply()', typeof host.apply === 'function')
check('the entry module exports its inject list', Array.isArray(host.inject))
const clientSource = readFileSync(new URL('client.js', root), 'utf8')
check('the browser half is a module-loader registration, not an ESM export', clientSource.startsWith('/**') || clientSource.includes('window.__ModuleLoader__.load({'), clientSource.slice(0, 24))
check('the browser half has no top-level import/export', !/^\s*(?:import|export)\s/m.test(clientSource))

console.log(failures === 0 ? '\nOK: host resolution audit passes' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
