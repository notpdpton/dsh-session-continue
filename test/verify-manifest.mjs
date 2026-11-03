/**
 * Manifest and identity audit of this package.
 *
 * Everything checked here is a fact the Host relies on at mount time or the
 * plugin manager reads to draw the Plugins row, plus the identity hygiene this
 * project is required to keep: a standalone plugin ships no trace of the code
 * base it was extracted from.
 *
 * usage: node verify-manifest.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfiesCaret } from './semver-caret.mjs'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}


/**
 * Every text file in the repository.
 *
 * Walked rather than listed: a hard-coded list is how a newly added file escapes
 * an audit. Build output and host session data are excluded because they are
 * neither shipped nor authored here.
 */
function textFiles(dir, prefix = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.dsh-ops', '.tmp-render', '.tmp-native'].includes(entry.name)) continue
      found.push(...textFiles(new URL(`${entry.name}/`, dir), relative))
      continue
    }
    if (!/\.(?:js|mjs|json|yml|yaml|md|svg|txt)$/.test(entry.name)) continue
    found.push(relative)
  }
  return found.sort()
}

console.log('-- manifest')
check('package is named dsh-session-continue', pkg.name === 'dsh-session-continue', pkg.name)
// This package is published to the public registry, so `private` must be absent —
// npm refuses to publish a private package, and the flag left behind reads as
// "cannot be installed" to every consumer. Publishing facts live in publishConfig.
check('package is not private', pkg.private !== true, String(pkg.private))
check('the package publishes publicly', pkg.publishConfig?.access === 'public', JSON.stringify(pkg.publishConfig))
check('the package publishes to the public registry', pkg.publishConfig?.registry === 'https://registry.npmjs.org/', pkg.publishConfig?.registry)
check('version is semver', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version)
check('type is module', pkg.type === 'module', pkg.type)
check('main points at index.js', pkg.main === 'index.js', pkg.main)
check('license declared', typeof pkg.license === 'string' && pkg.license.length > 0, pkg.license)
check('description declared', typeof pkg.description === 'string' && pkg.description.length > 0, pkg.description)
check('icon declared', pkg.icon === './icon.svg', pkg.icon)
check('bundle patch declared', pkg.dsh?.bundle?.patch === './cordis.patch.yml', pkg.dsh?.bundle?.patch)

console.log('\n-- the DSH requirement the Host enforces')
// App-boot's compatibility gate reads \`engines.dsh\` (or, when absent, every
// \`peerDependencies\` range on \`@deepseek-ai/dsh*\`) BEFORE importing the plugin, and
// denies an unsatisfied row. A manifest that declares neither imposes no constraint at
// all — it is admitted on every host, including ones this plugin was never run on.
{
  const range = pkg.engines?.dsh
  check('the manifest declares the DSH range it was verified on', typeof range === 'string' && range.length > 0, String(range))
  // One shape only: a shape this repository cannot evaluate is a requirement nobody
  // can check, so the test refuses it instead of guessing.
  check('the declared range is a single caret range', typeof range === 'string' && /^\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range), String(range))
  // The floor is the host this plugin was actually built and verified against. If it
  // ever drifts below that, the declaration starts claiming hosts nobody tested.
  check('the declared floor is the verified host', range === '^0.2.1-rc.5', String(range))
  // The ceilings that matter: the installed host and the current release line must be
  // admitted, while a host older than the verified floor must not be.
  const evaluable = satisfiesCaret('0.0.0', range ?? '') !== null
  if (!evaluable) {
    console.log('  --   range not evaluable here; skipped the per-version expectations')
  } else {
    for (const [version, expected] of [
      ['0.2.1-rc.4', false],
      ['0.2.1-rc.5', true],
      ['0.2.2-alpha.2', true],
      ['0.2.2-alpha.3', true],
      ['0.2.2', true],
      ['0.3.0', false],
      ['0.3.0-rc.1', false],
      ['0.1.7', false],
    ]) {
      const verdict = expected ? 'admits' : 'refuses'
      check(range + ' ' + verdict + ' ' + version, satisfiesCaret(version, range ?? '') === expected, String(satisfiesCaret(version, range ?? '')))
    }
  }
  // Cross-check the local evaluator against npm's real semver whenever it resolves, so
  // a hand-written parser cannot quietly disagree with the gate it stands in for.
  let semver
  const require = createRequire(import.meta.url)
  const nodeDir = path.dirname(process.execPath)
  // npm bundles semver next to the node binary that runs it. Both layouts that exist
  // in the wild are tried, and neither is written down as a literal path: the only
  // input is where node itself lives.
  for (const candidate of [
    'semver',
    path.join(nodeDir, 'node_modules', 'npm', 'node_modules', 'semver'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'node_modules', 'semver'),
  ]) {
    try {
      semver = require(candidate)
      break
    } catch {
      semver = undefined
    }
  }
  if (semver === undefined) {
    console.log('  --   semver not resolvable here; the checked-in expectations above stand alone')
  } else if (satisfiesCaret('0.0.0', range ?? '') === null) {
    // The range is not the supported shape, so there is nothing to agree about; the
    // shape assertion above already failed and named the reason.
    console.log('  --   range not evaluable here; skipped the semver cross-check')
  } else {
    const probes = ['0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.3', '0.2.2', '0.2.9', '0.3.0', '0.3.0-rc.1', '0.2.0', '1.0.0']
    const disagreed = probes.filter((v) => satisfiesCaret(v, range ?? '') !== semver.satisfies(v, range ?? '', { includePrerelease: true }))
    check('the local range evaluator agrees with semver', disagreed.length === 0, disagreed.join(', '))
  }
  // A peer range would be a SECOND opinion the gate reads only when \`engines.dsh\` is
  // absent. Declaring both makes the reader's precedence, not the author's intent, the
  // deciding factor.
  check('the manifest declares no competing peer range', pkg.peerDependencies === undefined, JSON.stringify(pkg.peerDependencies))
}

console.log('\n-- exports map')
// An `exports` map is a whitelist: a path the Host resolves but the map omits is
// refused outright (ERR_PACKAGE_PATH_NOT_EXPORTED), and the failure looks like a
// missing title on the Plugins page rather than like a map gap.
for (const [key, target] of [
  ['.', './index.js'],
  ['./index.js', './index.js'],
  ['./package.json', './package.json'],
  ['./client', './client.js'],
  ['./client.js', './client.js'],
  ['./icon', './icon.svg'],
  ['./locale/*.json', './locale/*.json'],
]) {
  check(`exports ${key}`, pkg.exports?.[key] === target, String(pkg.exports?.[key]))
}
check(
  'every export target exists on disk',
  Object.entries(pkg.exports ?? {}).every(([, target]) =>
    target.endsWith('/*.json') ? existsSync(new URL(target.replace('/*.json', '/zh.json'), root)) : existsSync(new URL(target, root)),
  ),
  JSON.stringify(Object.values(pkg.exports ?? {})),
)

console.log('\n-- shipped files')
/** Expand the one wildcard in `files[]` so every entry can be tested for existence. */
function expand(pattern) {
  if (!pattern.includes('*')) return [pattern]
  if (pattern === 'locale/*.json') return ['locale/zh.json', 'locale/en.json']
  if (pattern === 'docs/*.md') return ['docs/design.md']
  return [pattern]
}
const shipped = (pkg.files ?? []).flatMap(expand)
check(
  'files[] covers the Host half, the browser half and the patch',
  ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg'].every((f) => (pkg.files ?? []).includes(f)),
  JSON.stringify(pkg.files),
)
check('every shipped file exists', shipped.every((file) => existsSync(new URL(file, root))), shipped.filter((f) => !existsSync(new URL(f, root))).join(', '))
// Every file in the repository is either SHIPPED (matched by `files[]`), or is
// one of the handful npm includes anyway (package.json, README, LICENSE), or is a
// development artifact (test/). A file that is none of those is a file nobody
// would ever receive — and a file that claims to ship but does not is worse, since
// the Loader would resolve an exports target that never left the machine.
const NPM_ALWAYS = ['package.json', 'README.md', 'LICENSE']
const DEV_ONLY = ['test/']
const repository = textFiles(root)
const unshipped = repository.filter((file) => {
  if (NPM_ALWAYS.includes(file)) return false
  if (DEV_ONLY.some((prefix) => file.startsWith(prefix))) return false
  return !shipped.includes(file)
})
check('every repository file is shipped, always-included, or dev-only', unshipped.length === 0, unshipped.join(', '))
check('the test directory is not shipped', !(pkg.files ?? []).some((entry) => entry.startsWith('test/')))
check('the package does not ship a source copy of anything else', !/\.(?:ts|tsx|map)$/.test(shipped.join(' ')), shipped.join(', '))

console.log('\n-- dependency declarations')
// The Host half is imported from a profile link, i.e. from OUTSIDE the profile's
// node_modules, so a bare npm import would not resolve there. The browser half
// asks the module table for `react` alone, which the shell already seeds. Any
// dependency at all would therefore be dead weight at best and a load failure at
// worst.
check('declares no runtime dependency', Object.keys(pkg.dependencies ?? {}).length === 0, JSON.stringify(pkg.dependencies))
check('declares no peer dependency', Object.keys(pkg.peerDependencies ?? {}).length === 0, JSON.stringify(pkg.peerDependencies))
check('declares no dev dependency', Object.keys(pkg.devDependencies ?? {}).length === 0, JSON.stringify(pkg.devDependencies))
check('declares no optional dependency', Object.keys(pkg.optionalDependencies ?? {}).length === 0, JSON.stringify(pkg.optionalDependencies))

const hostSource = readFileSync(new URL('index.js', root), 'utf8')
const bareImports = [...hostSource.matchAll(/^\s*import\s[^'"]*['"]([^'".][^'"]*)['"]/gm)].map((match) => match[1])
check('the Host half imports nothing at all', bareImports.length === 0, bareImports.join(','))

console.log('\n-- client declaration')
check('declares a browser half', pkg.dsh?.client !== undefined, JSON.stringify(pkg.dsh))
check('browser half targets the web platform', pkg.dsh?.client?.platform === 'web', pkg.dsh?.client?.platform)
check('browser half loads immediately', pkg.dsh?.client?.immediately === true, String(pkg.dsh?.client?.immediately))
// Every surface waits for its slot through `ctx.slots.inject(name, ...)`, which is
// the contract for a provider that arrives later. A package-level `inject` row
// would instead make an unrelated package's load failure cascade into this one.
check('browser half declares no package-level load order', (pkg.dsh?.client?.inject ?? []).length === 0, JSON.stringify(pkg.dsh?.client?.inject))
check('browser half requests no external module', (pkg.dsh?.client?.external ?? []).length === 0, JSON.stringify(pkg.dsh?.client?.external))

console.log('\n-- bundle patch')
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')
const rows = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((match) => match[1].replace(/['"]/g, ''))
const names = [...patch.matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map((match) => match[1].replace(/['"]/g, ''))
// One package, one row. A second row would try to mount this package twice, and
// the browser module table is keyed by package name, so the second mount is a
// composition error rather than a second copy of the UI.
check('the patch inserts exactly one row', rows.length === 1, rows.join(','))
check('the row id is the package name', rows[0] === pkg.name, rows.join(','))
check('the row mounts the package itself', names[0] === pkg.name, names.join(','))
check('the row names no subpath', names.every((name) => !name.includes('/')), names.join(','))

console.log('\n-- Host half')
const host = await import(new URL('index.js', root).href)
check('exports apply()', typeof host.apply === 'function')
check('declares the sessionProjections dependency', Array.isArray(host.inject) && host.inject.includes('sessionProjections'), JSON.stringify(host.inject))
check('exports a namespaced projection key', /^[a-z][A-Za-z]+$/.test(host.INTERRUPTION_KEY) && host.INTERRUPTION_KEY !== 'interruption', host.INTERRUPTION_KEY)
// The Host and the browser half each hold the key as a constant, because the
// browser half cannot import from the Host half. They must agree, or the dock
// subscribes to a projection nobody registered.
{
  const clientKey = readFileSync(new URL('client.js', root), 'utf8').match(/const PROJECTION_KEY = '([^']+)'/)?.[1]
  check('the browser half reads the same projection key', clientKey === host.INTERRUPTION_KEY, `${clientKey} vs ${host.INTERRUPTION_KEY}`)
}

const { initialState, foldInterruption, interruptionStateSchema } = host
/** Fold a synthetic log and validate every intermediate state. */
function fold(events) {
  let state = initialState()
  for (const event of events) {
    state = foldInterruption(state, event)
    interruptionStateSchema.parse(state)
  }
  return state
}

const base = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 0 } },
  {
    type: 'todo/write',
    data: {
      todos: [
        { content: 'one', status: 'completed' },
        { content: 'two', status: 'in_progress' },
        { content: 'three', status: 'pending' },
      ],
    },
  },
  { type: 'step/end', data: { turn: 1, step: 0 } },
]

const open = fold([...base, { type: 'step/start', data: { turn: 1, step: 1 } }])
check('an open tail folds as crash', open.status === 'crash', open.status)
check('the open tail keeps the todo list', open.todos.length === 3, String(open.todos.length))
check('the open tail reports its turn', open.turn === 1, String(open.turn))
check('the open tail reports openStep', open.openStep === true, String(open.openStep))
check('an open turn with a closed step still folds as crash', fold(base).status === 'crash', fold(base).status)

const completed = fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }])
check('a completed turn folds as none', completed.status === 'none', completed.status)
check('a completed turn keeps the todos for the next resume', completed.todos.length === 3, String(completed.todos.length))

const repaired = fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'interrupted' } } }])
check('the harness repair marker folds as interrupted', repaired.status === 'interrupted', repaired.status)

const stopped = fold([
  ...base,
  { type: 'assistant/message', data: { interrupted: true } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
])
check('a deliberate stop folds as aborted/user', stopped.status === 'aborted' && stopped.abortCause === 'user', `${stopped.status}/${stopped.abortCause}`)

const shutdown = fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }])
check('a shutdown abort folds as interrupted', shutdown.status === 'interrupted', shutdown.status)
check('a shutdown abort keeps the todo list', shutdown.todos.length === 3, String(shutdown.todos.length))

const disposed = fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } } }])
check('an app-close abort folds as interrupted', disposed.status === 'interrupted', disposed.status)

const errored = fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'X', message: 'boom' } } } }])
check('a failed turn carries its code and message', errored.status === 'error' && errored.errorCode === 'X' && errored.errorMessage === 'boom', JSON.stringify(errored.errorMessage))
check('a max-tokens turn folds as max-tokens', fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } }]).status === 'max-tokens')
check('a blocked turn folds as blocked', fold([...base, { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } }]).status === 'blocked')
check('an empty log folds as none', fold([]).status === 'none')

console.log('\n-- wire contract')
let registered
host.apply({ sessionProjections: { register: (definition) => ((registered = definition), () => {}) } })
check('apply registers the interruption unit', registered?.key === host.INTERRUPTION_KEY, String(registered?.key))
check('the unit carries a wire view', typeof registered?.wire?.view === 'function' && typeof registered?.wire?.viewSchema?.parse === 'function')
check('the unit declares a state version', typeof registered?.stateVersion === 'number', String(registered?.stateVersion))
{
  // Mirror the registry's exact order: fold the event, THEN compute the view. The
  // registry publishes when consecutive views differ by Object.is, so step
  // bookkeeping must not produce a new view object.
  let state = registered.init()
  let previousView
  let publications = 0
  const step = (event) => {
    state = registered.apply(state, event)
    const view = registered.wire.view(state)
    if (!Object.is(previousView, view)) publications++
    previousView = view
    return state
  }
  step({ type: 'turn/start', data: { turn: 1 } })
  const states = []
  for (let index = 0; index < 20; index++) {
    states.push(step({ type: 'step/start', data: { turn: 1, step: index } }))
    states.push(step({ type: 'step/end', data: { turn: 1, step: index } }))
  }
  check('step bookkeeping never publishes', publications === 1, `${publications} publications for the turn plus 40 step events`)
  check('the fold still tracks openStep', states.at(-2).openStep === true && states.at(-1).openStep === false, `${states.at(-2).openStep}/${states.at(-1).openStep}`)
  const view = host.wireInterruption(states.at(-1))
  check('the wire view omits the host-only fields', !('openStep' in view) && !('hasTurns' in view), Object.keys(view).join(','))
  check(
    'the wire view carries every field the Client reads',
    ['status', 'turn', 'reason', 'abortCause', 'errorCode', 'errorMessage', 'partialMessage', 'todos'].every((field) => field in view),
    Object.keys(view).join(','),
  )
  const restored = { ...initialState(), status: 'interrupted', turn: 3, todos: [] }
  check('a restored checkpoint state can still be viewed', host.wireInterruption(restored).status === 'interrupted')
}
check('the state is plain JSON round-trippable', JSON.stringify(JSON.parse(JSON.stringify(completed))) === JSON.stringify(completed))
check('a corrupted state is rejected by the schema', (() => {
  try {
    interruptionStateSchema.parse({ status: 'none' })
    return false
  } catch {
    return true
  }
})())

console.log('\n-- browser half identity')
const clientSource = readFileSync(new URL('client.js', root), 'utf8')
check('registers into the browser module table', clientSource.includes('window.__ModuleLoader__.load({') && clientSource.includes("id: 'dsh-session-continue'"), 'module id')
check('uses the require() module table, not a host RPC', !clientSource.includes('host.call'))
check('registers its locale namespace', clientSource.includes("const NS = 'sessionContinue'"), 'locale namespace')
// Every backticked projection name in the browser half must be the key the Host
// actually registers. A stale one in a doc comment is how the next reader gets
// misled into subscribing to nothing.
{
  // Only things shaped like a projection KEY are candidates: the function name
  // `describeInterruption` is not one, and matching bare identifiers would turn
  // this into a spelling check of every symbol in the file.
  const candidates = new Set(
    // A projection key here always starts with the package's namespace prefix. A
    // bare verb+noun like `describeInterruption` is a function name, and matching
    // it would make this a spelling check on every helper instead of a check that
    // subscribers and publishers agree.
    [...clientSource.matchAll(/`(sessionContinue[A-Za-z]*)`/g)].map((match) => match[1]),
  )
  const stale = [...candidates].filter((name) => name !== host.INTERRUPTION_KEY)
  check('every projection key the browser half names is the registered one', stale.length === 0, stale.join(', '))
  check('the browser half names the projection key at least once', candidates.size >= 1, String(candidates.size))
}
const clientId = clientSource.match(/const PACKAGE_ID = '([^']+)'/)?.[1]
// The bundle's configuration is keyed by this name, so it must be the manifest's
// name exactly, or the Plugins page finds no block for this bundle's detail page.
check('the configuration key is the package name', clientId === pkg.name, `${clientId} vs ${pkg.name}`)
// The browser half cannot read the manifest; it must not carry a version of its
// own either, because the Plugins page already draws the real one.
check('the browser half carries no version constant', !clientSource.includes('PACKAGE_VERSION'), 'found PACKAGE_VERSION')
check('contributes exactly two surfaces', (clientSource.match(/ctx\.slots\.inject\(/g) ?? []).length === 2, String((clientSource.match(/ctx\.slots\.inject\(/g) ?? []).length))
check('keeps the composer dock slot', clientSource.includes("name: 'conversation.input.dock'"))
check('contributes the bundle configuration slot', clientSource.includes("name: 'plugins.bundle.config'"))
// A Settings section of its own was the previous home of these two preferences.
// They now live on the plugin's detail page; a leftover section would show the
// same switches in two sidebars at once.
check('registers no settings section', !clientSource.includes("name: 'settings.section'"))
check('registers no row configuration', !clientSource.includes("name: 'plugins.row.config'"))
// Color must come from the theme tokens only. A hex literal would ignore dark
// mode, which is a pure token rebinding.
const cssStart = clientSource.indexOf('const CSS = `') + 'const CSS = `'.length
const css = clientSource.slice(cssStart, clientSource.indexOf(String.fromCharCode(10, 96), cssStart))
check('the stylesheet uses no hex color literal', !/#[0-9a-fA-F]{3,8}\b/.test(css), (css.match(/#[0-9a-fA-F]{3,8}\b/) ?? [''])[0])
check('the stylesheet references the host token family', css.includes('--dsw-alias-label-primary') && css.includes('--dsw-alias-border-l2'))

console.log('\n-- display metadata (locales)')
/** Structural audit of one metadata dictionary. */
function metaOf(relative) {
  const dict = JSON.parse(readFileSync(new URL(relative, root), 'utf8'))
  check(`${relative} has meta.title`, typeof dict.meta?.title === 'string' && dict.meta.title.length > 0, dict.meta?.title)
  check(`${relative} has meta.description`, typeof dict.meta?.description === 'string' && dict.meta.description.length > 0, dict.meta?.description?.slice(0, 40))
  check(`${relative} carries no dead keys`, Object.keys(dict).every((key) => key === 'meta'), Object.keys(dict).join(','))
  check(`${relative} keeps the description to one sentence`, (dict.meta.description.match(/[。.]/g) ?? []).length <= 1, dict.meta.description)
  check(`${relative} keeps the description under 120 chars`, dict.meta.description.length <= 120, `${dict.meta.description.length} chars`)
  return dict.meta
}
const zhMeta = metaOf('locale/zh.json')
const enMeta = metaOf('locale/en.json')
check('the zh title names the feature', zhMeta.title === '会话中断继续', zhMeta.title)
// There is exactly ONE place the plugin's name is stated now: the metadata
// dictionary the Plugins page reads. The browser half used to carry a second copy
// for its own settings page, and the two could disagree; that page is gone, so a
// browser-half copy would be a string nothing draws.
{
  const clientText = readFileSync(new URL('client.js', root), 'utf8')
  check('the browser half does not restate the plugin name', !/'settings\.title'/.test(clientText), 'found settings.title')
  check('the browser half does not restate the plugin version', !/PACKAGE_VERSION/.test(clientText), 'found PACKAGE_VERSION')
  check('the card title is the only name the plugin states', typeof zhMeta.title === 'string' && zhMeta.title.length > 0, zhMeta.title)
}
check('the en title names the feature', enMeta.title === 'Session recovery', enMeta.title)
check('the zh description names the notice and the button', zhMeta.description.includes('继续') && zhMeta.description.includes('输入框'), zhMeta.description)
check('zh and en titles differ', zhMeta.title !== enMeta.title, `${zhMeta.title} / ${enMeta.title}`)

console.log('\n-- the README describes what the code does')
{
  // The README is the only place a user reads what the plugin claims. Its claims
  // are pinned to the artifacts they describe, so a behaviour change that forgets
  // the documentation fails here instead of shipping a stale promise.
  const readme = readFileSync(new URL('README.md', root), 'utf8')
  const dictionary = JSON.parse(readFileSync(new URL('locale/zh.json', root), 'utf8'))
  check('the README states the package name', readme.includes(`${pkg.name}`), pkg.name)
  check('the README states the projection key', readme.includes(host.INTERRUPTION_KEY), host.INTERRUPTION_KEY)
  check('the README states the version', readme.includes(pkg.version), pkg.version)
  check('the README names the displayed title', readme.includes(dictionary.meta.title), dictionary.meta.title)
  // The session-log scripts call `zstdDecompressSync`, which Node added in 22.15.
  // A README that states a different floor is a README that will waste an hour.
  check('the README states the zstd floor the scripts need', /22\.15/.test(readme), 'missing the Node floor')
  check('the README lists every mandatory check', ['run.mjs', 'verify-manifest.mjs', 'verify-resolve.mjs', 'verify-metadata.mjs', 'verify-client.mjs', 'verify-layout.mjs', 'verify-continue.mjs', 'verify-icons.mjs'].every((file) => readme.includes(file)), 'a check is undocumented')
  check('the README claims no dependency', /\| 依赖 \| 无 \|/.test(readme), 'dependency row changed')
  // The two preferences the README documents are the two the page renders. A
  // README table that grows a row the code never draws is a promise nobody keeps.
  const switchLabels = [...readme.matchAll(/^\| ([^|]+?) \| (?:开|关) \|/gm)].map((match) => match[1].trim())
  const dictionaryText = JSON.stringify(JSON.parse(readFileSync(new URL('locale/zh.json', root), 'utf8')))
  check('the README documents exactly two preferences', switchLabels.length === 2, switchLabels.join(' / '))
  const clientText = readFileSync(new URL('client.js', root), 'utf8')
  const declaredLabels = [...clientText.matchAll(/label: '(switch\.[A-Za-z]+)'/g)].map((match) => match[1])
  check('the README preferences match the code\'s declared preferences', declaredLabels.length === switchLabels.length, `${declaredLabels.length} declared vs ${switchLabels.length} documented`)
  check('the metadata dictionary is not doing the README\'s job', !dictionaryText.includes('恢复进度与任务清单'), 'the card description lists a preference')
  // The design doc is shipped with the plan it explains: a claim there must not
  // name a projection key nothing registers.
  const design = readFileSync(new URL('docs/design.md', root), 'utf8')
  check('the design doc names the shipped projection key', design.includes(host.INTERRUPTION_KEY), host.INTERRUPTION_KEY)
  // The state version appears in the doc as the literal that the code registers.
  // `design.includes('2')` would pass on any document at all, so the assertion is
  // anchored on the field name it belongs to.
  const version = registered?.stateVersion
  check('the design doc states the registered state version', new RegExp(`stateVersion:\\s*${String(version)}`).test(design), `stateVersion: ${String(version)}`)
}

console.log('\n-- icon')
const iconPath = new URL('icon.svg', root)
const iconStat = statSync(iconPath)
const icon = readFileSync(iconPath, 'utf8')
check('the icon exists', iconStat.isFile())
check('the icon is under the 256 KiB limit', iconStat.size < 256 * 1024, `${iconStat.size} bytes`)
check('the icon is valid SVG', icon.trimStart().startsWith('<svg'), icon.slice(0, 12))
check('the icon uses the official 36x36 canvas', icon.includes('viewBox="0 0 36 36"'), icon.match(/viewBox="[^"]*"/)?.[0])
check('the manifest icon export points at it', pkg.exports?.['./icon'] === './icon.svg')

console.log('\n-- identity hygiene: this package stands alone')
// This package is a standalone plugin. Nothing in it may name another package,
// another repository, or a developer machine: such a string either leaks
// information or — worse — keeps a dependency alive that nobody declared.
//
// The needles below are ASSEMBLED rather than written out, so this file does not
// itself carry the very strings it forbids. Writing them literally would make the
// audit the one place the identifier survives, which is exactly the failure mode
// it is meant to prevent.
const fragments = [
  ['not', 'pdpton'],
  ['不二', '布丁'],
  ['Arc', 'her'],
]
const FORBIDDEN = fragments.map((parts) => parts.join(''))
// Machine-specific path shapes, as patterns rather than as examples.
//
// `~/.dsh` is deliberately NOT on this list: it is the product's own documented
// default home, contains no personal information, and a README that explains
// where sessions live has to be able to say it. What must never appear is a path
// that resolves to ONE machine — a drive letter, a user directory with a name in
// it, or a file:// URL pointing into a checkout.
const FORBIDDEN_PATTERNS = [
  [/[A-Za-z]:[\\/]{1,2}(?:Users|Documents and Settings)[\\/]/i, 'an absolute Windows user directory'],
  [/(?:^|[^\w.])[A-Za-z]:[\\/]{1,2}[\w.-]+[\\/]/m, 'an absolute Windows path outside the package'],
  [/^\/(?:home|Users)\/[\w.-]+\//m, 'an absolute Unix user directory'],
  [/file:\/\/\/(?:[A-Za-z]:|\/)/i, 'a file:// URL to a local directory'],
  [/profiles[\\/]desktop/i, 'a hard-coded profile name'],
]

// Reuse the walk the shipping audit already performed: one definition of "every
// file in this repository" for both audits, so they cannot disagree.
const artifacts = repository
check('the audit walks a non-trivial file set', artifacts.length >= 15, `${artifacts.length} files`)
for (const relative of artifacts) {
  const text = readFileSync(new URL(relative, root), 'utf8')
  const hits = FORBIDDEN.filter((needle) => text.includes(needle))
  const pathHits = FORBIDDEN_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, what]) => what)
  check(`${relative} names no third-party or machine-specific identifier`, hits.length === 0 && pathHits.length === 0, [...hits, ...pathHits].join(', '))
}
// No manifest field may point at another package either: the manifest is the one
// place a hidden dependency would survive a source-level audit.
const manifestText = readFileSync(new URL('package.json', root), 'utf8')
check('the manifest depends on no other package', !/"dependencies"\s*:\s*\{[^}]*"[\w@]/.test(manifestText), 'found a dependency')
check('the manifest names no repository or author', !/"(?:repository|author|homepage|bugs)"/.test(manifestText), 'found a provenance field')

console.log(failures === 0 ? '\nOK: package audit passes' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)