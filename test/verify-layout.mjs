/**
 * Static audit of the notice's layout rules.
 *
 * The notice has two states with different cross-axis alignment needs, and the
 * bug being guarded against here is precisely a mismatch between them: the text
 * column and the button column must agree on where "center" is. This checks the
 * CSS text, since the browser is not scriptable from here.
 *
 * usage: node verify-layout.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cssStart = source.indexOf('const CSS = `') + 'const CSS = `'.length
const css = source.slice(cssStart, source.indexOf(String.fromCharCode(10, 96), cssStart))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Read one rule's declarations by selector. */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Read one rule's declarations by selector. */
function rule(selector) {
  const match = css.match(new RegExp(`(?:^|\\n)${escapeRe(selector)}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : null
}

/** Read a declaration value out of a rule body. */
function decl(body, property) {
  if (body === null) return null
  // Declarations may be separated by `;`, a comment close, or plain newlines, so
  // anchor on a line start or a `;` rather than assuming `;` alone.
  const match = body.match(new RegExp(`(?:^|;|\\*/)\\s*${property}\\s*:\\s*([^;]+)`))
  return match ? match[1].trim() : null
}

console.log('-- the stylesheet parses')
check('the stylesheet is a template literal', cssStart > 'const CSS = `'.length, String(cssStart))
check('the stylesheet is not empty', css.length > 1000, `${css.length} chars`)
check('every rule body is balanced', (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length)

console.log('\n-- collapsed card')
const card = rule('.sc-card')
check('.sc-card rule exists', card !== null)
check('the card centers its cross axis while collapsed', decl(card, 'align-items') === 'center', decl(card, 'align-items'))
check('the card is a flex row', decl(card, 'display') === 'flex', decl(card, 'display'))
check('the card cannot overflow its seat', decl(card, 'box-sizing') === 'border-box', decl(card, 'box-sizing'))

const main = rule('.sc-main')
check('.sc-main takes the free space', decl(main, 'flex') === '1', decl(main, 'flex'))
const collapsedMain = rule('.sc-card:not([data-expanded="true"]) .sc-main')
check(
  'the collapsed text column centers vertically',
  decl(collapsedMain, 'justify-content') === 'center',
  decl(collapsedMain, 'justify-content'),
)

const actions = rule('.sc-actions')
check('.sc-actions rule exists', actions !== null)
check(
  'the button group does NOT override the card alignment',
  decl(actions, 'align-self') === null,
  decl(actions, 'align-self'),
)
check('the button group keeps its own children centered', decl(actions, 'align-items') === 'center', decl(actions, 'align-items'))

console.log('\n-- expanded card')
const expandedCard = rule('.sc-card[data-expanded="true"]')
check('the expanded card anchors to the top', decl(expandedCard, 'align-items') === 'flex-start', decl(expandedCard, 'align-items'))
check('no expanded-only align-self override remains', !css.includes('.sc-card[data-expanded="true"] .sc-actions'))

console.log('\n-- line boxes')
const title = rule('.sc-title')
const reason = rule('.sc-reason')
const button = rule('.sc-button')
check('title line-height is set', decl(title, 'line-height') === '22px', decl(title, 'line-height'))
check('reason line-height matches the title', decl(reason, 'line-height') === '22px', decl(reason, 'line-height'))
check('button has a fixed height', decl(button, 'height') === '30px', decl(button, 'height'))
check(
  'the button is a flex box that centers its own label',
  decl(button, 'display') === 'inline-flex' && decl(button, 'align-items') === 'center',
  `${decl(button, 'display')} / ${decl(button, 'align-items')}`,
)
check('the reason ellipsizes instead of wrapping', decl(reason, 'text-overflow') === 'ellipsis', decl(reason, 'text-overflow'))
check('the reason never grows past its column', decl(reason, 'min-width') === '0', decl(reason, 'min-width'))

console.log('\n-- expanded details')
{
  // The panel opens INSIDE the card, on the card's own surface. A hairline above it
  // would divide one notice into two boxes, which is exactly the seam the user
  // asked to be removed; the row grid alone carries the structure.
  const details = rule('.sc-details')
  check('.sc-details rule exists', details !== null)
  check('the expanded panel draws no separator line', decl(details, 'border-top') === null, String(decl(details, 'border-top')))
  check('the expanded panel adds no vertical padding of its own', decl(details, 'padding-top') === null, String(decl(details, 'padding-top')))
  check('the panel keeps its gap from the title row', decl(details, 'margin-top') === '8px', String(decl(details, 'margin-top')))
  check('the panel is a single column', decl(details, 'display') === 'flex' && decl(details, 'flex-direction') === 'column', `${decl(details, 'display')}/${decl(details, 'flex-direction')}`)
  // The row grid never draws lines of its own either.
  const detailRow = rule('.sc-detailRow')
  check('detail rows draw no separators', decl(detailRow, 'border-bottom') === null && decl(detailRow, 'border-top') === null, `${decl(detailRow, 'border-bottom')}/${decl(detailRow, 'border-top')}`)
  check('no rule in the stylesheet draws a border-top hairline', !/border-top\s*:/.test(css), (css.match(/[^\n]*border-top\s*:[^;]*/) ?? [''])[0])
}

console.log('\n-- every class the client uses is styled')
{
  // Read the browser half the same way the other checks do: the CSS block and the
  // JSX that names classes. A class that is used but never defined is a typo; one
  // that is defined but never used is a rule nothing can reach.
  const jsx = source.slice(0, cssStart) + source.slice(source.indexOf(String.fromCharCode(10, 96), cssStart))
  const defined = new Set([...css.matchAll(/\.(sc-[A-Za-z0-9_-]+)/g)].map((match) => match[1]))
  const used = new Set([...jsx.matchAll(/['"](sc-[A-Za-z0-9_-]+)['"]/g)].map((match) => match[1]))
  const undefinedClasses = [...used].filter((name) => !defined.has(name))
  const unreachable = [...defined].filter((name) => !used.has(name))
  check('every class the client names has a rule', undefinedClasses.length === 0, undefinedClasses.join(', '))
  check('every class rule is reachable from the client', unreachable.length === 0, unreachable.join(', '))
}

console.log('\n-- themes')
check('the card paint comes from a token', (decl(card, 'box-shadow') ?? '').includes('var(--dsw-'), decl(card, 'box-shadow'))
check('the backdrop pseudo-element is inset to the card', decl(rule('.sc-card::before'), 'inset') === '0', decl(rule('.sc-card::before'), 'inset'))
check('the notice root never exceeds the composer card', (decl(rule('.sc-root'), 'max-width') ?? '').includes('var(--dsh-composer-card-max-width)'), decl(rule('.sc-root'), 'max-width'))

console.log('\n-- settings page')
const row = rule('.sc-row')
check('.sc-row is a flex row', decl(row, 'display') === 'flex', decl(row, 'display'))
check('.sc-row pads its own vertical rhythm', decl(row, 'padding') === '16px 0', decl(row, 'padding'))
check('the last row of the list drops its separator', css.includes('.sc-row:last-child { border-bottom: 0; }'))
// The switch geometry is the measured one: 36x20 track, 16px thumb, 2px inset,
// so the travel is exactly 36 - 16 - 2*2 = 16.
const switchRule = rule('.sc-switch')
check('the switch has a fixed 36x20 track', decl(switchRule, 'width') === '36px' && decl(switchRule, 'height') === '20px', `${decl(switchRule, 'width')}x${decl(switchRule, 'height')}`)
const thumb = rule('.sc-switch::after')
check('the thumb is 16px and inset 2px', decl(thumb, 'width') === '16px' && decl(thumb, 'top') === '2px' && decl(thumb, 'left') === '2px', `${decl(thumb, 'width')} @ ${decl(thumb, 'top')},${decl(thumb, 'left')}`)
check('the switch thumb translates by its own travel', css.includes('translateX(16px)'))
// The page heading is the HOST's job now (the block is rendered inside the
// plugin's detail page), so this block must not draw one: a second heading inside
// the host's page would print the plugin's name twice.
check('the block draws no heading of its own', rule('.sc-pageTitle') === null && rule('.sc-pageTitleRow') === null, 'found a heading rule')
const rowLabel = rule('.sc-rowLabel')
const rowDesc = rule('.sc-rowDesc')
check('the row title is 14/22', decl(rowLabel, 'font-size') === '14px' && decl(rowLabel, 'line-height') === '22px', `${decl(rowLabel, 'font-size')}/${decl(rowLabel, 'line-height')}`)
check('the row description is 12/18', decl(rowDesc, 'font-size') === '12px' && decl(rowDesc, 'line-height') === '18px', `${decl(rowDesc, 'font-size')}/${decl(rowDesc, 'line-height')}`)
// Both interactive controls must be reachable by keyboard: every element with a
// :hover rule (the two the user can actually operate) needs a :focus-visible twin,
// otherwise the switch and the buttons are invisible to a keyboard user.
for (const control of ['.sc-button', '.sc-switch']) {
  check(`${control} draws a focus ring`, new RegExp(escapeRe(control) + ':focus-visible').test(css))
}
const hoverTargets = [...new Set([...css.matchAll(/^(\.[a-z-]+)\[?[^{\n]*:hover/gm)].map((match) => match[1]))].sort()
const missingFocus = hoverTargets.filter((selector) => !css.includes(`${selector}:focus-visible`))
check('every hoverable control has a focus-visible twin', missingFocus.length === 0, missingFocus.join(', '))
check('no focus ring is removed globally', !/outline\s*:\s*none/.test(css), 'found outline:none')
// The two disabled opacities the design system defines: .4 for buttons, .45-.5
// for switches. A hand-picked grey would break both.
check('the disabled button uses the design system opacity', (decl(rule('.sc-button:disabled'), 'opacity') ?? '') === '.4', decl(rule('.sc-button:disabled'), 'opacity'))
{
  // Monospace is for identifiers, and the host's code stack is a token the user
  // can override. A bare font stack would ignore that.
  const mono = rule('.sc-detailValue[data-mono="true"]')
  check('the monospace face comes from the host token', (decl(mono, 'font-family') ?? '').includes('var(--ds-font-family-code'), decl(mono, 'font-family'))
}

console.log(failures === 0 ? '\nOK: layout rules are consistent' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
