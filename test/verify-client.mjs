/**
 * Offline verification of the browser half (client.js): slot registrations, the
 * locale dictionaries, and the localized copy the notice renders.
 *
 * It executes the SHIPPED file by shimming `window.__ModuleLoader__` and a
 * minimal `react`, so the check is of the real artifact rather than a copy.
 *
 * usage: node verify-client.mjs
 */
import { readFileSync } from 'node:fs'

let captured
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      captured = entry
    },
  },
}
globalThis.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null
  },
  setItem(key, value) {
    this.store.set(key, String(value))
  },
}

// Execute the shipped file; the loader shim captures the registration.
// eslint-disable-next-line no-eval
new Function('window', readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(globalThis.window)

const reactStub = {
  // Must return a truthy node: the checks below assert "rendered something".
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  // `client.js` destructures React once, at factory time, so the component closes
  // over THIS function reference. A seed hook therefore has to be routed through
  // the reference itself rather than by reassigning `reactStub.useState`.
  useRef: (init) => ({ current: init }),
  useState: (init) => {
    const initial = typeof init === 'function' ? init() : init
    return [reactStub.__seed(initial), () => {}]
  },
  /** Identity by default; a test may install a seeder to force one cell's value. */
  __seed: (initial) => initial,
}

const plugin = captured.factory((id) => {
  if (id === 'react') return reactStub
  throw new Error(`unexpected require: ${id}`)
})

const registrations = []
let currentSlot
const zh = () => registrations.find((r) => r.kind === 'locale')?.dicts?.zh ?? {}
const ctx = {
  locale: {
    register: (ns, dicts) => {
      registrations.push({ kind: 'locale', ns, dicts })
      return () => {}
    },
    bind: (ns) => (key, params) => {
      const dict = zh()
      let text = dict[key] ?? key
      if (params) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      return text
    },
  },
  effect: (fn) => fn(),
  slots: {
    // The registration callback is a zero-argument closure that reads
    // `ctx.slots.register`, so both verbs live on this same object.
    inject: (slot, cb) => {
      currentSlot = slot
      cb()
      currentSlot = undefined
      return () => {}
    },
    register: (options, Component) => {
      registrations.push({ kind: 'slot', slot: currentSlot, options, Component })
      return () => {}
    },
  },
}

plugin.apply(ctx)

const localeReg = registrations.find((r) => r.kind === 'locale')
const slots = registrations.filter((r) => r.kind === 'slot')
const dock = slots.find((s) => s.slot === 'conversation.input.dock')
const bundleConfig = slots.find((s) => s.slot === 'plugins.bundle.config')

console.log('plugin exports:', Object.keys(plugin))
console.log('locale ns:', localeReg?.ns, '| keys:', Object.keys(localeReg?.dicts?.zh ?? {}).length)
console.log('slots:', slots.map((s) => `${s.slot}#${s.options.id}@${s.options.order}`))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n-- registrations')
check('the plugin declares its injected services', JSON.stringify(plugin.inject) === JSON.stringify(['slots', 'locale']), JSON.stringify(plugin.inject))
check('exactly two surfaces are registered', slots.length === 2, String(slots.length))
// The preferences live on the plugin's own detail page, not on a Settings page of
// their own: two switches do not deserve a sidebar entry, and the plugin manager
// already owns the bundle's page.
check('registers no settings section', slots.every((s) => s.slot !== 'settings.section'), slots.map((s) => s.slot).join(', '))
check('registers the bundle configuration slot', bundleConfig !== undefined, slots.map((s) => s.slot).join(', '))
check(
  'the configuration is keyed by the bundle package name (not a row key)',
  bundleConfig?.options.key === 'dsh-session-continue' && !String(bundleConfig?.options.key).includes('#'),
  bundleConfig?.options.key,
)
// The page dispatches `plugins.bundle.config` with `pkg.name` as the entry key, so
// the registration key IS the contract: a typo here renders the plugin's whole
// configuration nowhere, with no error to notice.
{
  const manifestName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
  check('the configuration key is the installed package name', bundleConfig?.options.key === manifestName, `${bundleConfig?.options.key} vs ${manifestName}`)
}
check('the configuration declares the plugin locale namespace', bundleConfig?.options.locale === 'sessionContinue', bundleConfig?.options.locale)
check('dock uses a fresh id (does not replace a shipped dock)', dock?.options.id === 'sessionContinue-interrupted', dock?.options.id)
check('dock sits above the shipped todo dock (order < 0)', dock?.options.order < 0, String(dock?.options.order))
check('dock declares the plugin locale namespace', dock?.options.locale === 'sessionContinue', dock?.options.locale)
check('dock component is a function', typeof dock?.Component === 'function')
// Every registered identity is namespaced to this package: a bare id would either
// replace a shipped surface or collide with another plugin's.
for (const [label, value] of [
  ['dock id', dock?.options.id],
  ['locale namespace', localeReg?.ns],
]) {
  check(`${label} is namespaced`, typeof value === 'string' && value.startsWith('sessionContinue'), value)
}

console.log('\n-- locale parity')
const zhKeys = new Set(Object.keys(localeReg.dicts.zh))
const enKeys = new Set(Object.keys(localeReg.dicts.en))
check('zh and en cover the same key set', zhKeys.size === enKeys.size && [...zhKeys].every((k) => enKeys.has(k)), `${zhKeys.size} vs ${enKeys.size}`)
check('the dictionary is substantial', zhKeys.size >= 30, String(zhKeys.size))

const t = ctx.locale.bind('sessionContinue')

// The Plugins page draws the bundle's name and version itself, so this half must
// not carry either: a name here would be a second copy that can drift, and the
// version could only ever go stale.
console.log('\n-- one name, stated once')
check('the dictionary carries no plugin title', !zhKeys.has('settings.title'), [...zhKeys].filter((k) => k.startsWith('settings.')).join(','))
check('the dictionary carries no version hint', !zhKeys.has('settings.versionHint'), 'found settings.versionHint')
check('the summary line is prose, not a control', typeof t('settings.description') === 'string' && t('settings.description').length > 0, t('settings.description'))

console.log('\n-- localized copy (zh)')
const expected = {
  title: '会话未正常结束',
  // Reasons are fragments, not sentences: the title already carries the outcome,
  // so a reason that restates "the last run was…" would double the message.
  'reason.crash': '进程异常退出',
  'reason.interrupted': '重启或连接中断',
  'reason.aborted': '被手动停止',
  'continue.label': '继续',
  'details.show': '详情',
  'details.hide': '收起',
  'detail.turn': '中断轮次',
  'detail.none': '无',
  dismiss: '忽略',
  'switch.progressRestore': '恢复进度与任务清单',
  'switch.notifyUserAbort': '提示手动停止的会话',
}
for (const [key, value] of Object.entries(expected)) check(`${key}`, t(key) === value, t(key))

// A reason must not repeat the title's own claim.
for (const status of ['crash', 'interrupted', 'error', 'maxTokens', 'blocked', 'aborted']) {
  const reason = t(`reason.${status}`)
  check(
    `reason.${status} does not restate the title`,
    !reason.includes('未正常结束') && !reason.includes('上次运行') && !reason.includes('上一轮'),
    reason,
  )
}
// The shipped conversation dock already renders the todo list, so this plugin
// must not carry its own copy of that vocabulary.
check('no todo progress copy in this plugin', !zhKeys.has('summary.progress') && !zhKeys.has('detail.progress'))
check('no progress-summary switch', !zhKeys.has('switch.progressSummary'))

// The reason is stated ONCE, in the collapsed line. Detail vocabulary that
// restated the same ending in another wording would let the two views drift.
for (const removed of ['detail.status', 'detail.ending', 'detail.cause']) {
  check(`no detail row restating the reason (${removed})`, zhKeys.has(removed) === false)
}
check('no status.* wording table', [...zhKeys].every((k) => !k.startsWith('status.')))
check('no ending.* wording table', [...zhKeys].every((k) => !k.startsWith('ending.')))
check('no cause.* wording table', [...zhKeys].every((k) => !k.startsWith('cause.')))

// Setting descriptions state what the option does, not a taxonomy of the cases it
// covers. A short ceiling keeps them from drifting back into prose.
console.log('\n-- setting descriptions stay concise')
for (const key of ['settings.description', 'switch.progressRestore.desc', 'switch.notifyUserAbort.desc']) {
  const text = t(key)
  check(`${key} is a single sentence`, (text.match(/[。.]/g) ?? []).length <= 1, text)
  check(`${key} stays under 40 chars`, text.length <= 40, `${text.length} chars: ${text}`)
}
// The enumerations removed by hand must not creep back in.
for (const noise of ['进程意外退出', '中途被打断', '达到长度上限']) {
  check(`no case enumeration "${noise}" in any description`, !t('settings.description').includes(noise))
}

console.log('\n-- dock render decisions')
// The Component is rendered through a stub hook set for each interruption status;
// output presence is the contract: every unclean ending shows; only a clean
// completion stays silent.
function renderDock(view, { running = false } = {}) {
  const props = {
    t,
    inputActions: { setDraft: () => {}, submit: () => {} },
    useProjection: () => view,
    useSession: (selector) => selector({ running, pendingSubmissions: [], removed: false }),
  }
  return dock.Component(props)
}

const crashView = {
  status: 'crash',
  turn: 2,
  reason: null,
  abortCause: null,
  errorCode: null,
  errorMessage: null,
  openStep: true,
  hasTurns: true,
  todos: [
    { content: '研究 API', status: 'completed' },
    { content: '实现检测逻辑', status: 'in_progress' },
    { content: '验证', status: 'pending' },
  ],
}
check('crash shows the notice', renderDock(crashView) !== null)
check('harness repair marker (interrupted) shows the notice', renderDock({ ...crashView, status: 'interrupted', openStep: false }) !== null)
check('crash while the agent is running renders nothing', renderDock(crashView, { running: true }) === null)
check('clean turn renders nothing', renderDock({ ...crashView, status: 'none', turn: 1 }) === null)
// Every unclean ending gets a notice, the user's own Stop included.
check('user stop shows the notice (reason explained)', renderDock({ ...crashView, status: 'aborted', abortCause: 'user' }) !== null)
check('app-close abort shows the notice', renderDock({ ...crashView, status: 'aborted', abortCause: 'disposed' }) !== null)
check('failed turn shows the notice', renderDock({ ...crashView, status: 'error', errorMessage: 'boom' }) !== null)
check('max-tokens shows the notice', renderDock({ ...crashView, status: 'max-tokens' }) !== null)
check('blocked turn shows the notice', renderDock({ ...crashView, status: 'blocked' }) !== null)
check('absent projection renders nothing', renderDock(undefined) === null)
check('a projection without a status renders nothing', renderDock({ turn: 1, todos: [] }) === null)

console.log('\n-- collapsed notice and Details')
/** Depth-first walk of the stub element tree (stub-rendering nested components). */
function walk(node, visit) {
  if (node === null || node === undefined) return
  // An array child is a child LIST, not a node: flatten it.
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props ?? {}), visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function collect(view) {
  const found = { buttons: [], detailsRows: [], text: [] }
  walk(renderDock(view), (node) => {
    if (node.type === 'button') found.buttons.push(node)
    if (node.props?.className === 'sc-detailRow') found.detailsRows.push(node)
  })
  return found
}

const collapsed = collect({ ...crashView, status: 'error', errorMessage: 'provider said no' })
check('collapsed notice has no detail rows', collapsed.detailsRows.length === 0, String(collapsed.detailsRows.length))
const detailsButton = collapsed.buttons.find((b) => b.props['aria-expanded'] !== undefined)
check('a Details toggle is rendered', detailsButton !== undefined)
check('Details starts collapsed', detailsButton?.props['aria-expanded'] === false, String(detailsButton?.props['aria-expanded']))
check('Details label is the show label', detailsButton.children?.[0] === '详情', detailsButton.children?.[0])
check('collapsed notice keeps Continue and Dismiss', collapsed.buttons.length === 3, String(collapsed.buttons.length))

// Expand the notice. The component closes over the React stub's `useState` at
// factory time, so the seeder rides `__seed`.
//
// Declaration order is: switch snapshot (object), busy (false), outcome (null),
// dismissed (null), expanded (false). `expanded` is therefore the SECOND
// `false`-initialised cell, not the first.
function renderWithExpanded(view, expanded) {
  let seenSwitches = false
  let falseCells = 0
  let seeded = false
  reactStub.__seed = (initial) => {
    if (typeof initial === 'object' && initial !== null) seenSwitches = true
    if (seenSwitches && initial === false) falseCells += 1
    if (seenSwitches && !seeded && initial === false && falseCells === 2) {
      seeded = true
      return expanded
    }
    return initial
  }
  try {
    return dock.Component({
      t,
      inputActions: { setDraft: () => {}, submit: () => {} },
      useProjection: () => view,
      useSession: (selector) => selector({ running: false, pendingSubmissions: [], removed: false }),
    })
  } finally {
    reactStub.__seed = (initial) => initial
  }
}

const expandedTree = renderWithExpanded({ ...crashView, status: 'error', errorMessage: 'provider said no', errorCode: 'E42' }, true)
const expanded = { buttons: [], detailsRows: [], rowTexts: [] }
/** Read the visible text out of a stub element tree. */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(node.props ?? {}))
  return (node.children ?? []).map(textOf).join('')
}
walk(expandedTree, (node) => {
  if (node.type === 'button') expanded.buttons.push(node)
  if (node.props?.className === 'sc-detailRow') expanded.detailsRows.push(node)
})
// One row's text is its label immediately followed by its value.
const rowTexts = expanded.detailsRows.map(textOf)
check('expanded shows detail rows', expanded.detailsRows.length > 0, String(expanded.detailsRows.length))
// The detail panel elaborates, it does not restate: turn + error code + message
// are the facts the collapsed line does not carry.
check('details carry the turn', rowTexts.some((text) => text.startsWith('中断轮次')), rowTexts.join(' | '))
check('details carry the error code', rowTexts.some((text) => text.includes('E42')), rowTexts.join(' | '))
check('details carry the full error message', rowTexts.some((text) => text.includes('provider said no')), rowTexts.join(' | '))
check(
  'no detail row repeats the ending reason',
  !rowTexts.some((text) => text.startsWith('结束状态') || text.startsWith('结束方式') || text.startsWith('中止来源')),
  rowTexts.join(' | '),
)
const detailsToggle = expanded.buttons.find((b) => b.props['aria-expanded'] !== undefined)
check('the toggle reports expanded', detailsToggle?.props['aria-expanded'] === true, String(detailsToggle?.props['aria-expanded']))
check('toggle label switched to hide', detailsToggle.children?.[0] === '收起', detailsToggle.children?.[0])
check('details still expose Continue and Dismiss', expanded.buttons.length === 3, String(expanded.buttons.length))

console.log('\n-- details always present, empty values labelled')
// A bare notice (no error) must STILL show every row, each marked as empty rather
// than silently dropped, so the panel has a stable shape.
const bareTree = renderWithExpanded({ ...crashView, status: 'interrupted', todos: [], turn: 1, errorCode: null, errorMessage: null }, true)
const bareRows = []
walk(bareTree, (node) => {
  if (node.props?.className === 'sc-detailRow') bareRows.push(textOf(node))
})
const expectedLabels = ['中断轮次', '错误代码', '错误信息']
for (const label of expectedLabels) {
  check(`row "${label}" is always shown`, bareRows.some((text) => text.startsWith(label)), bareRows.join(' | '))
}
const emptyRows = bareRows.filter((text) => expectedLabels.some((label) => text === `${label}无`))
check('empty values are labelled 无', emptyRows.length >= 2, bareRows.join(' | '))
check(
  'the details do not repeat the todo panel',
  !bareRows.some((text) => text.startsWith('任务进度')),
  bareRows.join(' | '),
)

// Monospace marks a real code. The "无" placeholder is prose, so it must render in
// the normal face — otherwise an empty row looks like a machine value.
/** Collect the rendered value cells, keyed by their row label. */
function valueCells(view, expanded) {
  const cells = {}
  const tree = renderWithExpanded(view, expanded)
  walk(tree, (node) => {
    if (node.props?.className !== 'sc-detailRow') return
    const parts = []
    walk(node, (inner) => {
      if (inner.props?.className === 'sc-detailLabel') parts[0] = textOf(inner)
      if (inner.props?.className === 'sc-detailValue') parts[1] = inner
    })
    if (parts[0] !== undefined && parts[1] !== undefined) cells[parts[0]] = parts[1]
  })
  return cells
}

const withCode = valueCells({ ...crashView, status: 'error', errorCode: 'E42' }, true)
check('a real error code renders monospaced', withCode['错误代码']?.props['data-mono'] === 'true', String(withCode['错误代码']?.props['data-mono']))

const withoutCode = valueCells({ ...crashView, status: 'interrupted', errorCode: null, errorMessage: null }, true)
check('an empty error code renders "无"', textOf(withoutCode['错误代码']) === '无', textOf(withoutCode['错误代码']))
check(
  'the "无" placeholder is NOT monospaced',
  withoutCode['错误代码']?.props['data-mono'] === undefined,
  String(withoutCode['错误代码']?.props['data-mono']),
)

console.log('\n-- accessibility wiring')
{
  // The card is the live region for the whole notice, so a status change reaches a
  // screen reader without the user having to find the new text.
  const card = []
  walk(renderDock(crashView), (node) => {
    if (node.props?.className === 'sc-card') card.push(node)
  })
  check('the notice card is the live region', card.length === 1 && card[0].props.role === 'status', card[0]?.props.role)
  // Exactly one live region: a second one inside it would double-announce.
  let statuses = 0
  walk(renderDock({ ...crashView, status: 'error', errorMessage: 'boom' }), (node) => {
    if (node.props?.role === 'status') statuses++
  })
  check('the notice owns exactly one status role', statuses === 1, String(statuses))
  // aria-controls must name an element that exists in the same tree — in BOTH
  // states, because the body is only rendered while expanded.
  for (const [state, tree] of [
    ['collapsed', renderDock(crashView)],
    ['expanded', expandedTree],
  ]) {
    const ids = new Set()
    const controls = []
    walk(tree, (node) => {
      if (typeof node.props?.id === 'string') ids.add(node.props.id)
      if (typeof node.props?.['aria-controls'] === 'string') controls.push(node.props['aria-controls'])
    })
    check(`no dangling aria-controls while ${state}`, controls.every((id) => ids.has(id)), controls.filter((id) => !ids.has(id)).join(', '))
    check(
      state === 'expanded' ? 'the expanded toggle declares what it controls' : 'the collapsed toggle controls nothing missing',
      state === 'expanded' ? controls.length === 1 : controls.length === 0,
      String(controls.length),
    )
  }
  // Every button must be a real button with a label, or a keyboard user cannot
  // reach or understand it.
  const unlabeled = []
  walk(renderDock(crashView), (node) => {
    if (node.type !== 'button') return
    const hasText = (node.children ?? []).some((child) => typeof child === 'string' && child.length > 0)
    if (!hasText && typeof node.props?.['aria-label'] !== 'string') unlabeled.push(JSON.stringify(node.props))
  })
  check('every button has a visible or accessible label', unlabeled.length === 0, unlabeled.join(' | '))
}

console.log('\n-- the notice is dismissible per interruption')
/** Render, click one button by its variant/label predicate, and return the new tree. */
function clickDismiss(view) {
  const found = { dismiss: undefined }
  walk(renderDock(view), (node) => {
    if (node.type === 'button' && node.props?.['data-variant'] === 'ghost' && node.children?.[0] === '忽略') found.dismiss = node
  })
  return found.dismiss
}
const stopView = { ...crashView, status: 'aborted', abortCause: 'user' }
const dismissButton = clickDismiss(stopView)
check('a Dismiss button is rendered', dismissButton !== undefined)
check('Dismiss is not disabled while idle', dismissButton?.props.disabled === false, String(dismissButton?.props.disabled))
check('Dismiss carries no aria-pressed state', dismissButton?.props['aria-pressed'] === undefined)

console.log('\n-- the block leaves the page chrome to the host')
// The Plugins page draws the title, the icon, the package name and the version
// tag. A block that drew its own heading would print the plugin's identity twice
// on one screen, and a second version number could only ever go stale.
const configTree = bundleConfig.Component({ t, view: 'page' })
for (const ownChrome of ['sc-pageTitle', 'sc-pageTitleRow', 'sc-pageId', 'sc-pageVersion', 'sc-pageHead', 'sc-pageDesc']) {
  let found = 0
  walk(configTree, (node) => {
    if (node.props?.className === ownChrome) found++
  })
  check(`the block draws no ${ownChrome}`, found === 0, String(found))
}
// `view: 'summary'` is plain text: a bundle page falls back to it only when the
// package carries no description, and a control there would be unreachable.
const summary = bundleConfig.Component({ t, view: 'summary' })
check('the summary view renders text', typeof summary === 'string' && summary.length > 0, String(summary))
check('the summary view carries no controls', !String(summary).includes('<'), String(summary).slice(0, 60))

console.log('\n-- the configuration block')
/** The switch controls of the configuration block, in render order. */
function switchControls() {
  const found = []
  walk(bundleConfig.Component({ t, view: 'page' }), (node) => {
    if (node.type === 'button' && node.props?.role === 'switch') found.push(node)
  })
  return found
}
const switches = switchControls()
const labels = switches.map((node) => node.props['aria-label'])
check('the page renders one switch per preference', switches.length === 2, String(switches.length))
check('switches cover the two preferences in order', labels.join('|') === '恢复进度与任务清单|提示手动停止的会话', labels.join('|'))
check('all switches default to on', switches.every((node) => node.props['aria-checked'] === true))
check('switches are proper aria switches', switches.every((node) => node.props.role === 'switch'))
check('every switch is a real button element', switches.every((node) => node.type === 'button'))
check('no master on/off switch in the block', !labels.includes('会话中断继续'), labels.join(' | '))
check('no window-placement preference leaks in', !labels.some((label) => label.includes('窗口')), labels.join(' | '))

// Toggling must be reflected on the next render: the store is shared by both
// surfaces, which is what makes the notice react without a reload.
switches[1].props.onClick()
const afterToggle = switchControls()
check('toggling a switch flips its aria-checked', afterToggle[1].props['aria-checked'] === false, String(afterToggle[1].props['aria-checked']))
check('toggling one switch leaves the other alone', afterToggle[0].props['aria-checked'] === true, String(afterToggle[0].props['aria-checked']))
check('turning the switch back on restores it', (switchControls()[1].props.onClick(), switchControls()[1].props['aria-checked'] === true))

console.log(failures === 0 ? '\nOK: client half checks pass' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)