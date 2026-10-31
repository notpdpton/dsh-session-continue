/**
 * Offline verification of the Continue action and the preference switches.
 *
 * Drives the shipped Component through its real handlers (setDraft/submit) and
 * inspects the message text it produces, plus the switch gating.
 *
 * usage: node verify-continue.mjs
 */
import { readFileSync } from 'node:fs'

let captured
globalThis.window = { __ModuleLoader__: { load: (e) => (captured = e) } }
globalThis.localStorage = { store: new Map(), getItem: () => null, setItem: () => {} }
new Function('window', readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(globalThis.window)

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  // `client.js` latches synchronous state through a ref; the stub hands back a
  // stable box so a handler can be driven twice against the same render.
  useRef: (init) => ({ current: init }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
}

const plugin = captured.factory((id) => {
  if (id === 'react') return reactStub
  throw new Error(`unexpected require: ${id}`)
})

const reg = []
let slot
const ctx = {
  locale: {
    register: (ns, dicts) => {
      reg.push({ kind: 'locale', ns, dicts })
      return () => {}
    },
    bind: () => (key, params) => {
      const dict = reg.find((r) => r.kind === 'locale')?.dicts.zh ?? {}
      let text = dict[key] ?? key
      if (params) text = text.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
      return text
    },
  },
  effect: (fn) => fn(),
  slots: {
    inject: (name, cb) => {
      slot = name
      cb()
      return () => {}
    },
    register: (options, Component) => {
      reg.push({ kind: 'slot', slot, options, Component })
      return () => {}
    },
  },
}
plugin.apply(ctx)

const t = ctx.locale.bind('sessionContinue')
const dock = reg.find((r) => r.kind === 'slot' && r.slot === 'conversation.input.dock')

/** Depth-first walk of the stub element tree, collecting nodes by predicate. */
function walk(node, visit) {
  if (node === null || node === undefined) return
  // An array is a child LIST, not a node: flatten it.
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  // A function-typed node is a React component element; stub-render it so nested
  // components are inspectable too.
  if (typeof node.type === 'function') {
    walk(node.type(node.props ?? {}), visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** Render the dock with a recording input action set. */
function render(view, { running = false } = {}) {
  const calls = { drafts: [], submits: 0 }
  const tree = dock.Component({
    t,
    inputActions: {
      setDraft: (text) => calls.drafts.push(text),
      submit: () => (calls.submits += 1),
    },
    useProjection: () => view,
    useSession: (selector) => selector({ running, pendingSubmissions: [], removed: false }),
  })
  return { tree, calls }
}

/** Find the primary (Continue) button in a rendered tree. */
function continueButton(tree) {
  let found
  walk(tree, (node) => {
    if (node.type === 'button' && node.props?.['data-variant'] === 'primary') found = node
  })
  return found
}

const todos = [
  { content: '研究 DSH API', status: 'completed' },
  { content: '实现中断检测', status: 'in_progress' },
  { content: '验证插件', status: 'pending' },
  { content: '撰写说明', status: 'pending' },
]
const crashView = {
  status: 'crash',
  turn: 2,
  reason: null,
  abortCause: null,
  errorCode: null,
  errorMessage: null,
  openStep: true,
  hasTurns: true,
  todos,
}

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ── Continue action ──────────────────────────────────────────────────────────
console.log('-- continue action')
const rendered = render(crashView)
const firstContinue = continueButton(rendered.tree)
check('primary (Continue) button exists', firstContinue !== undefined)
check('Continue button is enabled while idle', firstContinue?.props?.disabled === false, String(firstContinue?.props?.disabled))

firstContinue.props.onClick()
check('clicking Continue writes one draft', rendered.calls.drafts.length === 1, String(rendered.calls.drafts.length))
const draft = rendered.calls.drafts[0] ?? ''
console.log('\n--- generated continue message ---')
console.log(draft)
console.log('--- end ---\n')
check('submit was called once (normal composer submission)', rendered.calls.submits === 1, String(rendered.calls.submits))
check('draft states the interruption', draft.includes('上次会话未正常结束'))
check('draft includes the progress line with the turn', draft.includes('第 2 轮'))
check('draft includes the todo list head', draft.includes('上次的任务清单'))
check('draft carries the in-progress item', draft.includes('实现中断检测'))
check('draft marks completed items as 已完成', draft.includes('[已完成] 研究 DSH API'))
check('draft marks pending items as 待处理', draft.includes('[待处理] 验证插件'))
check('draft is not trivially short', draft.length > 80, String(draft.length))
check('draft is plain text (no markup reaches the composer)', !draft.includes('<') && !draft.includes('&nbsp;'), draft.slice(0, 40))

// ── Message shape ────────────────────────────────────────────────────────────
console.log('-- message shape')
check('the instruction is the first line', draft.split('\n')[0] === '上次会话未正常结束，检查进度，然后继续。', draft.split('\n')[0])
check('the progress line follows it', draft.split('\n')[1] === '上次中断于第 2 轮。', draft.split('\n')[1])
check('the todo head follows', draft.split('\n')[2] === '上次的任务清单：', draft.split('\n')[2])
check('every todo becomes exactly one line', draft.split('\n').filter((line) => line.startsWith('- [')).length === todos.length, String(draft.split('\n').filter((line) => line.startsWith('- [')).length))
check('lines are separated by a single newline', !draft.includes('\n\n'), JSON.stringify(draft.slice(0, 60)))

// A fully completed plan carries nothing to resume, so it must not be pasted in.
const doneView = { ...crashView, todos: todos.map((todo) => ({ ...todo, status: 'completed' })) }
const doneRendered = render(doneView)
continueButton(doneRendered.tree).props.onClick()
const doneDraft = doneRendered.calls.drafts[0] ?? ''
check('a fully completed plan is not pasted in', !doneDraft.includes('研究 DSH API'), doneDraft)
check('a fully completed plan keeps the instruction', doneDraft.includes('上次会话未正常结束'), doneDraft)

// An empty projection is not a crash, so the button is not even rendered.
const emptyTodos = { ...crashView, todos: [] }
const emptyRendered = render(emptyTodos)
continueButton(emptyRendered.tree).props.onClick()
const emptyDraft = emptyRendered.calls.drafts[0] ?? ''
check('an empty todo list still resumes', emptyDraft.includes('上次会话未正常结束'), emptyDraft)
check('an empty todo list omits the todo head', !emptyDraft.includes('上次的任务清单'), emptyDraft)

// ── Idempotence guard ────────────────────────────────────────────────────────
console.log('-- the button cannot double-submit')
// `busy` is set before the draft is written, and the handler returns early while
// it is true, so two clicks in the same tick submit once.
const doubleRendered = render(crashView)
const doubleButton = continueButton(doubleRendered.tree)
doubleButton.props.onClick()
doubleButton.props.onClick()
check('two clicks in one tick submit once', doubleRendered.calls.submits === 1, String(doubleRendered.calls.submits))

// ── Switch gating ────────────────────────────────────────────────────────────
console.log('-- preference switches')
const configSlot = reg.find((r) => r.kind === 'slot' && r.slot === 'plugins.bundle.config')
/**
 * The switch controls of the plugin's configuration block, in render order.
 *
 * The block lives on the plugin's own Plugins detail page now, so this drives it
 * through the slot that page dispatches (`view: 'page'`) instead of a removed
 * Settings section.
 */
function renderSettings() {
  const found = []
  walk(configSlot.Component({ t, view: 'page' }), (node) => {
    if (node.type === 'button' && node.props?.role === 'switch') found.push(node)
  })
  return found
}
const switches = renderSettings()
console.log(`  (dock tree has ${(() => { let n = 0; walk(render(crashView).tree, (node) => { if (node.type === 'button' && node.props?.role === 'switch') n++ }); return n })()} switch controls; switches live on the settings page)`)
check('the configuration block renders one switch per preference', switches.length === 2, String(switches.length))
const labels = switches.map((s) => s.props['aria-label'])
console.log(`  labels: ${JSON.stringify(labels)}`)
check('switches cover the preferences in order', labels.join('|') === '恢复进度与任务清单|提示手动停止的会话', labels.join('|'))
check('all switches default to on', switches.every((s) => s.props['aria-checked'] === true))

// Turning progress-restore off must drop the todo block from the message.
switches[0].props.onClick()
const noRestore = render(crashView)
continueButton(noRestore.tree).props.onClick()
const draft2 = noRestore.calls.drafts[0] ?? ''
console.log(`\n--- continue message with progress restore OFF ---\n${draft2}\n--- end ---\n`)
check('without progress restore the todo list is absent', !draft2.includes('[已完成]'))
check('without progress restore the turn line is absent', !draft2.includes('第 2 轮'), draft2)
check('without progress restore the instruction still resumes', draft2.includes('上次会话未正常结束'))

// ── The manual-stop preference ───────────────────────────────────────────────
console.log('-- the manual-stop preference')
const stopView = { ...crashView, status: 'aborted', abortCause: 'user' }
check('a manual stop shows while the preference is on', continueButton(render(stopView).tree) !== undefined)
// progressRestore is currently OFF; this preference is independent of it.
check('the two preferences do not interfere', continueButton(render(crashView).tree) !== undefined)
renderSettings()[1].props.onClick()
check('a manual stop is hidden once the preference is off', continueButton(render(stopView).tree) === undefined)
check('other endings still show with the preference off', continueButton(render({ ...crashView, status: 'crash' }).tree) !== undefined)
renderSettings()[1].props.onClick()
check('turning the preference back on restores the notice', continueButton(render(stopView).tree) !== undefined)

// Restore progress-restore so the run leaves a clean default behind.
renderSettings()[0].props.onClick()
check('progress restore is back on', renderSettings()[0].props['aria-checked'] === true, String(renderSettings()[0].props['aria-checked']))

// ── While the agent runs ─────────────────────────────────────────────────────
console.log('-- suppressed while the agent runs')
check('no Continue button while a turn is live', continueButton(render(crashView, { running: true }).tree) === undefined)
check('the dock renders nothing at all while live', dock.Component({
  t,
  inputActions: { setDraft: () => {}, submit: () => {} },
  useProjection: () => crashView,
  useSession: (selector) => selector({ running: true, pendingSubmissions: [], removed: false }),
}) === null)

console.log(failures === 0 ? '\nOK: continue action and switches pass' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
