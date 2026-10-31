/**
 * Icon audit: structure, self-containment, gradients, identifiers, palette and
 * geometry, with an optional raster cross-check when a renderer happens to be
 * installed.
 *
 * Everything that binds runs without any dependency: the geometry evaluator is
 * pure JavaScript, so a clean checkout with no native modules can still prove the
 * artwork stays inside the official safe area. The rasterizer is only ever an
 * extra opinion, and its absence is reported as a skip rather than silently
 * trusted.
 *
 * usage: node verify-icons.mjs
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)

/** The official icon canvas, in user units. */
const VIEW_BOX = [0, 0, 36, 36]
/** Documented safe area: where the official 36x36 set keeps its optical footprint. */
const SAFE_MIN = 6
const SAFE_MAX = 31.5
/** npm packages and the renderer both choke on large resources. */
const MAX_BYTES = 256 * 1024
/** Raster sample used to measure geometry: 8x the 36-unit canvas. */
const SAMPLE = 288
/** Alpha (of 255) at or above which a sample counts as painted; drops edge fuzz. */
const INK_ALPHA = 8
/** Allowed distance, in 36-unit space, between the evaluator and the raster. */
const TOLERANCE = 0.5

/**
 * The official palette: the colors the shipped 36x36 plugin icons paint with. A
 * color from outside this map is a style break, not a taste call.
 */
const PALETTE = new Map(
  Object.entries({
    // neutral ink, mask fill, and the one neutral gradient end in the set
    '#FFFFFF': 'neutral ink',
    '#000000': 'mask cut-out',
    '#E2E2E2': 'neutral gradient end',
    // blues: the dominant family
    '#7AC2FF': 'sky',
    '#7CB7FF': 'sky',
    '#7FB7FC': 'sky',
    '#6DB9FB': 'sky',
    '#69B9FF': 'sky',
    '#67C7FE': 'cyan-blue',
    '#6FB2EE': 'steel',
    '#86B8F5': 'steel',
    '#679EFE': 'accent',
    '#658EFF': 'accent',
    '#4D6BFE': 'primary',
    '#4A65E8': 'primary deep',
    '#4561EE': 'indigo',
    '#3F77D8': 'indigo',
    '#3E58D6': 'indigo deep',
    '#3650DE': 'indigo deep',
    '#324DE2': 'indigo deep',
    '#145AF3': 'blue strong',
    '#5269E1': 'periwinkle',
    // teals, cyans and mints
    '#108792': 'teal deep',
    '#37A6B1': 'teal',
    '#45D9E7': 'cyan',
    '#51CFDB': 'cyan',
    '#41E1AC': 'mint',
    '#6AECB6': 'mint',
    // violet and amber accents
    '#A797FC': 'lilac',
    '#A23AE7': 'violet',
    '#F2AF63': 'amber',
  }),
)

/** Elements that put ink on the canvas. */
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'])
/** Color-valued presentation attributes and inline style properties. */
const COLOR_PROPS = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'])

let failures = 0
let skipped = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function skip(label, why) {
  skipped++
  console.log(`  skip ${label} — ${why}`)
}
function note(label, detail) {
  console.log(`  note ${label} — ${detail}`)
}

// ---------------------------------------------------------------- markup utilities

/** Parse an attribute string into a lower-cased name -> value map. */
function attrsOf(source) {
  const attrs = new Map()
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs.set(match[1].toLowerCase(), match[2] === undefined ? match[3] : match[2])
  }
  return attrs
}

/** Attribute body that does not stop at a '>' inside a quoted value. */
const BODY = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*?`

/** Every opening element in the markup, with parsed attributes. */
function elementsOf(markup) {
  const pattern = new RegExp('<([a-zA-Z][a-zA-Z0-9:_-]*)(' + BODY + ')/?>', 'g')
  const elements = []
  for (const match of markup.matchAll(pattern)) {
    elements.push({ name: match[1].toLowerCase(), attrs: attrsOf(match[2]) })
  }
  return elements
}

/** Normalize #rgb / #rrggbb to upper-case #RRGGBB; anything else is no palette literal. */
function normalizeHex(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (match === null) return null
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1]
  return '#' + digits.toUpperCase()
}

/** Judge one color value: palette member, neutral keyword, or offender. */
function judgeColor(value, used, offenders) {
  const trimmed = value.trim()
  if (trimmed === '') return
  if (/^(none|currentColor|transparent|inherit)$/.test(trimmed)) return
  if (/^url\(\s*#[^)]+\)$/.test(trimmed)) return
  const normalized = normalizeHex(trimmed)
  if (normalized !== null && PALETTE.has(normalized)) used.add(normalized)
  else offenders.add(trimmed)
}

/** Collect every painted color, and every color value outside the official palette. */
function colorsOf(markup) {
  const used = new Set()
  const offenders = new Set()
  // A hex literal anywhere outside url(#id) / href="#id" is a color; there the #
  // starts an id, and an id such as "abc" would otherwise read as the color #ABC.
  const scrubbed = markup
    .replace(/url\(\s*['"]?#[^)]*\)/g, 'url(#)')
    .replace(/((?:xlink:)?href\s*=\s*)(?:"#[^"]*"|'#[^']*')/gi, '$1"#')
  for (const match of scrubbed.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const normalized = normalizeHex(match[0])
    if (normalized !== null && PALETTE.has(normalized)) used.add(normalized)
    else offenders.add(match[0])
  }
  for (const element of elementsOf(markup)) {
    for (const [name, value] of element.attrs) {
      if (name === 'style') {
        for (const declaration of value.split(';')) {
          const parts = declaration.split(':')
          if (COLOR_PROPS.has((parts[0] ?? '').trim().toLowerCase())) {
            judgeColor(parts.slice(1).join(':'), used, offenders)
          }
        }
      } else if (COLOR_PROPS.has(name)) {
        judgeColor(value, used, offenders)
      }
    }
  }
  return { used: [...used].sort(), offenders: [...offenders].sort() }
}

/** Parse every linear gradient with its attribute map and stop count. */
function gradientsOf(markup) {
  const pattern = new RegExp('<linearGradient\\b(' + BODY + ')(?:/>|>([\\s\\S]*?)</linearGradient>)', 'gi')
  const gradients = []
  for (const match of markup.matchAll(pattern)) {
    const body = match[2] === undefined ? '' : match[2]
    gradients.push({ attrs: attrsOf(match[1]), stops: (body.match(/<stop\b/gi) || []).length })
  }
  return gradients
}

// ---------------------------------------------------------------- geometry evaluator

/** Parse a path's `d` into a bounding box, supporting the commands the icons use. */
function pathBox(d) {
  const problems = []
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  let index = 0
  let command = null
  let x = 0
  let y = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const points = []
  const add = (px, py) => {
    points.push([px, py])
    minX = Math.min(minX, px)
    minY = Math.min(minY, py)
    maxX = Math.max(maxX, px)
    maxY = Math.max(maxY, py)
  }
  const num = () => Number(tokens[index++])
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++]
    if (command === undefined || command === null) {
      problems.push('path starts without a command')
      break
    }
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M': {
        const px = num()
        const py = num()
        x = relative ? x + px : px
        y = relative ? y + py : py
        add(x, y)
        // Extra coordinate pairs after a moveto are implicit linetos.
        command = relative ? 'l' : 'L'
        break
      }
      case 'L': {
        const px = num()
        const py = num()
        x = relative ? x + px : px
        y = relative ? y + py : py
        add(x, y)
        break
      }
      case 'H': {
        const px = num()
        x = relative ? x + px : px
        add(x, y)
        break
      }
      case 'V': {
        const py = num()
        y = relative ? y + py : py
        add(x, y)
        break
      }
      case 'Z': {
        if (points.length > 0) add(points[0][0], points[0][1])
        break
      }
      default:
        problems.push(`path command "${command}" is not supported by the geometry evaluator`)
        return { box: null, problems }
    }
  }
  return { box: minX === Infinity ? null : [minX, minY, maxX, maxY], problems }
}

/** Bounding box of one painted element, in 36-unit space, stroke included. */
function elementBox(element) {
  const attributes = element.attrs
  const n = (name, fallback = 0) => {
    const value = attributes.get(name)
    return value === undefined ? fallback : Number(value)
  }
  const strokeWidth = n('stroke-width', 0)
  const stroke = attributes.get('stroke')
  const fill = attributes.get('fill')
  const painted = (fill !== undefined && fill !== 'none') || (stroke !== undefined && stroke !== 'none' && strokeWidth > 0)
  if (!painted) return { box: null, problems: [] }
  let box = null
  let problems = []
  switch (element.name) {
    case 'circle': {
      const r = n('r')
      box = [n('cx') - r, n('cy') - r, n('cx') + r, n('cy') + r]
      break
    }
    case 'ellipse': {
      const rx = n('rx')
      const ry = n('ry')
      box = [n('cx') - rx, n('cy') - ry, n('cx') + rx, n('cy') + ry]
      break
    }
    case 'rect': {
      const width = n('width')
      const height = n('height')
      box = [n('x'), n('y'), n('x') + width, n('y') + height]
      break
    }
    case 'line':
      box = [Math.min(n('x1'), n('x2')), Math.min(n('y1'), n('y2')), Math.max(n('x1'), n('x2')), Math.max(n('y1'), n('y2'))]
      break
    case 'polyline':
    case 'polygon': {
      const numbers = (attributes.get('points') ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (numbers.length < 2) {
        problems.push(`<${element.name}> has no points`)
        break
      }
      const xs = numbers.filter((_, index) => index % 2 === 0)
      const ys = numbers.filter((_, index) => index % 2 === 1)
      box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      break
    }
    case 'path': {
      const parsed = pathBox(attributes.get('d') ?? '')
      box = parsed.box
      problems = parsed.problems
      break
    }
    default:
      problems.push(`<${element.name}> is not supported by the geometry evaluator`)
  }
  if (box === null) return { box: null, problems }
  if (stroke !== undefined && stroke !== 'none' && strokeWidth > 0) {
    const half = strokeWidth / 2
    box = [box[0] - half, box[1] - half, box[2] + half, box[3] + half]
  }
  return { box, problems }
}

/** Measure the union box of every painted element in one icon. */
function measureSvg(markup) {
  const elements = elementsOf(markup)
  const transforms = []
  const problems = []
  const boxes = []
  for (const element of elements) {
    if (element.attrs.has('transform')) transforms.push(`<${element.name}> transform="${element.attrs.get('transform')}"`)
    if (!SHAPES.has(element.name)) continue
    const measured = elementBox(element)
    problems.push(...measured.problems)
    if (measured.box !== null) boxes.push(measured.box)
  }
  if (boxes.length === 0) return { box: null, elements, problems, transforms, painted: 0 }
  const box = [
    Math.min(...boxes.map((entry) => entry[0])),
    Math.min(...boxes.map((entry) => entry[1])),
    Math.max(...boxes.map((entry) => entry[2])),
    Math.max(...boxes.map((entry) => entry[3])),
  ]
  return { box, elements, problems, transforms, painted: boxes.length }
}

/** Format a box the way the report prints footprints. */
function formatBox(box) {
  if (box === null || box === undefined) return 'none'
  return 'x ' + box[0].toFixed(1) + '..' + box[2].toFixed(1) + ' y ' + box[1].toFixed(1) + '..' + box[3].toFixed(1)
}

// ---------------------------------------------------------------- rasterization

/**
 * Locate a sharp build for the raster checks.
 *
 * sharp is deliberately NOT a dependency of this package (it ships zero
 * dependencies), so nothing guarantees a copy next to the icon. The candidates
 * are, in order: an explicit override and this checkout. When none loads, the
 * raster checks report `skip` — the markup rules, which are the ones that bind,
 * still run and still fail.
 */
const RENDER_REQUIRE_ROOTS = process.env.DSH_ICON_RENDER_ROOT ? [process.env.DSH_ICON_RENDER_ROOT] : [root]
let sharp = null
for (const candidate of RENDER_REQUIRE_ROOTS) {
  try {
    sharp = createRequire(candidate)('sharp')
    break
  } catch {
    sharp = null
  }
}
const RENDER_SEARCH = RENDER_REQUIRE_ROOTS.map(String).join(', ')

/** Rasterize on a transparent 8x canvas and measure where the painted pixels land. */
async function measureFootprint(buffer) {
  const { data, info } = await sharp(buffer, { density: 72 * (SAMPLE / 36) })
    .resize(SAMPLE, SAMPLE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  let painted = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] < INK_ALPHA) continue
      painted++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const unit = 36 / info.width
  return {
    ink: (painted / (info.width * info.height)) * 100,
    left: painted === 0 ? null : minX * unit,
    top: painted === 0 ? null : minY * unit,
    right: painted === 0 ? null : (maxX + 1) * unit,
    bottom: painted === 0 ? null : (maxY + 1) * unit,
  }
}

// ---------------------------------------------------------------- read the icons

/** Every icon this package ships. */
const ICONS = [{ label: 'package icon', path: 'icon.svg' }]

const records = []
for (const icon of ICONS) {
  const file = new URL(icon.path, root)
  let stat = null
  try {
    stat = statSync(file)
  } catch {
    stat = null
  }
  const svg = stat === null ? null : readFileSync(file, 'utf8')
  const record = { label: icon.label, path: icon.path, stat, svg }
  if (svg !== null) {
    const markup = svg.replace(/<!--[\s\S]*?-->/g, '')
    const rootPattern = new RegExp('<svg\\b(' + BODY + ')>', 'i')
    const rootMatch = rootPattern.exec(markup)
    record.buffer = Buffer.from(svg, 'utf8')
    record.markup = markup
    record.elements = elementsOf(markup)
    record.rootAttrs = rootMatch === null ? null : attrsOf(rootMatch[1])
    record.svgTags = (markup.match(/<svg\b/gi) || []).length
    record.gradients = gradientsOf(markup)
    record.ids = record.elements.flatMap((element) => (element.attrs.has('id') ? [element.attrs.get('id')] : []))
    record.refs = [...markup.matchAll(/url\(\s*#([^)\s]+)\s*\)/g)].map((match) => match[1])
    record.colors = colorsOf(markup)
    record.shapes = record.elements.filter((element) => SHAPES.has(element.name)).length
  }
  records.push(record)
}

// ---------------------------------------------------------------- structure

console.log('-- structure')
for (const record of records) {
  const label = record.label
  check(label + ' exists', record.stat !== null && record.stat.isFile(), record.path)
  if (record.svg === null) continue
  check(label + ' is under the 256 KiB limit', record.stat.size < MAX_BYTES, record.stat.size + ' B')
  check(label + ' parses as a single <svg> root', record.rootAttrs !== null && record.svgTags === 1, record.svgTags + ' <svg> tags')
  check(
    label + ' declares the SVG namespace',
    record.rootAttrs === null ? false : record.rootAttrs.get('xmlns') === 'http://www.w3.org/2000/svg',
    record.rootAttrs === null ? 'no root' : record.rootAttrs.get('xmlns') || 'missing xmlns',
  )
  const viewBox = record.rootAttrs === null ? null : (record.rootAttrs.get('viewbox') || '').trim().split(/[\s,]+/).map(Number)
  check(
    label + ' uses the 36x36 viewBox',
    viewBox !== null && viewBox.length === 4 && viewBox.every((value, index) => value === VIEW_BOX[index]),
    record.rootAttrs === null ? 'no root' : record.rootAttrs.get('viewbox') || 'no viewBox',
  )
  const width = record.rootAttrs === null ? undefined : record.rootAttrs.get('width')
  const height = record.rootAttrs === null ? undefined : record.rootAttrs.get('height')
  const sized = [width, height].every((value) => value === undefined || /^36(?:px)?$/i.test(value.trim()))
  check(label + ' fixes no conflicting pixel size', sized, 'width=' + (width || '-') + ' height=' + (height || '-'))
}

// ---------------------------------------------------------------- self-containment

console.log('\n-- self-containment')
for (const record of records) {
  if (record.svg === null) continue
  const label = record.label
  const markup = record.markup
  const withoutNamespaces = markup.replace(/xmlns(?::[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
  check(label + ' embeds no raster payload', !/<image\b/i.test(markup) && !/;base64,|data:image\//i.test(markup))
  check(label + ' embeds no script or event handler', !/<script\b/i.test(markup) && !/\son[a-z]+\s*=/i.test(markup))
  check(
    label + ' references nothing external',
    !/https?:\/\//i.test(withoutNamespaces) && !/\bhref\s*=/i.test(withoutNamespaces) && !/url\(\s*['"]?(?:https?:|data:)/i.test(markup),
  )
  check(label + ' ships no stylesheet', !/<style\b/i.test(markup) && !/<\?xml-stylesheet/i.test(markup))
  check(label + ' paints no text', !/<text\b|<tspan\b|<textPath\b|<foreignObject\b/i.test(markup))
  const animated = record.elements.some((element) => /\b(animation|transition)\s*:/i.test(element.attrs.get('style') || ''))
  check(
    label + ' is static (no animation)',
    !/<animate\b|<animateTransform\b|<animateMotion\b|<set\b|<mpath\b|<discard\b/i.test(markup) && !animated,
  )
}

// ---------------------------------------------------------------- gradients

console.log('\n-- gradients')
for (const record of records) {
  if (record.svg === null) continue
  const label = record.label
  check(label + ' uses linear gradients only', !/<radialGradient\b/i.test(record.markup))
  const wrongUnits = record.gradients.filter((gradient) => gradient.attrs.get('gradientunits') !== 'userSpaceOnUse')
  check(
    label + ' gradients are userSpaceOnUse',
    wrongUnits.length === 0,
    wrongUnits.map((gradient) => gradient.attrs.get('gradientunits') || 'missing gradientUnits').join(', '),
  )
  const thin = record.gradients.filter((gradient) => gradient.stops < 2)
  check(label + ' gradients have at least two stops', thin.length === 0, thin.length + ' gradient(s) with < 2 stops')
  const dangling = record.refs.filter((id) => !record.ids.includes(id))
  check(label + ' gradient references resolve', dangling.length === 0, dangling.map((id) => '#' + id).join(', '))
  const gradientFilled = record.elements.filter((element) => (element.attrs.get('fill') || '').startsWith('url(#')).length
  const totalStops = record.gradients.reduce((sum, gradient) => sum + gradient.stops, 0)
  note(label + ' gradients', record.gradients.length + ' linear, ' + totalStops + ' stops, ' + gradientFilled + ' shape(s) gradient-filled')
}

// ---------------------------------------------------------------- identifiers

console.log('\n-- identifiers')
for (const record of records) {
  if (record.svg === null) continue
  const duplicates = record.ids.filter((id, index) => record.ids.indexOf(id) !== index)
  check(record.label + ' ids are unique', duplicates.length === 0, duplicates.map((id) => '#' + id).join(', '))
  // A generic id ("a", "gradient") collides with any other icon inlined on the
  // same page, and the browser resolves url(#id) document-wide, so the wrong
  // drawing gets the wrong paint.
  const generic = record.ids.filter((id) => id.length < 6)
  check(record.label + ' ids are namespaced, not generic', generic.length === 0, generic.map((id) => '#' + id).join(', '))
}

// ---------------------------------------------------------------- palette

console.log('\n-- palette')
for (const record of records) {
  if (record.svg === null) continue
  check(record.label + ' uses only official palette colors', record.colors.offenders.length === 0, record.colors.offenders.join(', '))
  note(record.label + ' colors (' + record.colors.used.length + ')', record.colors.used.join(' '))
}

// ---------------------------------------------------------------- geometry

console.log('\n-- geometry')
for (const record of records) {
  if (record.svg === null) continue
  record.measurement = measureSvg(record.markup)
  record.footprint = record.measurement.box
}

for (const record of records) {
  if (record.svg === null) continue
  const measurement = record.measurement
  const box = record.footprint
  check(record.label + ' declares no transform', measurement.transforms.length === 0, measurement.transforms.join(', ') || 'none')
  check(record.label + ' uses only geometry the evaluator can measure', measurement.problems.length === 0, measurement.problems.join('; ') || 'none')
  check(record.label + ' paints a visible footprint', box !== null && box[2] > box[0] && box[3] > box[1], formatBox(box))
  check(
    record.label + ' footprint stays inside the ' + SAFE_MIN + '..' + SAFE_MAX + ' safe area',
    box !== null && box[0] >= SAFE_MIN && box[1] >= SAFE_MIN && box[2] <= SAFE_MAX && box[3] <= SAFE_MAX,
    formatBox(box),
  )
  // An icon that fills only a corner of the canvas renders at a visibly different
  // optical size than the shipped set, which all sit between ~13 and ~24 units.
  const spanX = box === null ? 0 : box[2] - box[0]
  const spanY = box === null ? 0 : box[3] - box[1]
  check(
    record.label + ' footprint is optically comparable to the shipped set',
    spanX >= 16 && spanX <= 25 && spanY >= 16 && spanY <= 25,
    `${spanX.toFixed(1)} x ${spanY.toFixed(1)} units`,
  )
  check(record.label + ' footprint is centered on the canvas', box !== null && Math.abs((box[0] + box[2]) / 2 - 18) <= 1 && Math.abs((box[1] + box[3]) / 2 - 18) <= 1, `center ${(((box?.[0] ?? 0) + (box?.[2] ?? 0)) / 2).toFixed(1)}, ${(((box?.[1] ?? 0) + (box?.[3] ?? 0)) / 2).toFixed(1)}`)
  const stroked = measurement.elements.filter((element) => Number(element.attrs.get('stroke-width') ?? 0) > 0)
  note(
    record.label + ' painted elements',
    measurement.painted + ' measured' + (stroked.length === 0 ? ', no stroke' : ', ' + stroked.length + ' stroked (half-width included)'),
  )
}

// Optional raster cross-check: same artwork, two independent measurements.
if (sharp === null) {
  skip('raster cross-check of the footprint (±' + TOLERANCE + ')', 'no sharp at ' + RENDER_SEARCH)
} else {
  note('icon renderer available (sharp)', 'vips ' + (sharp.versions?.vips ?? 'unknown'))
  for (const record of records) {
    if (record.svg === null) continue
    const raster = await measureFootprint(record.buffer)
    record.raster = raster
    const box = record.footprint
    const agrees =
      box !== null &&
      raster.left !== null &&
      Math.abs(box[0] - raster.left) <= TOLERANCE &&
      Math.abs(box[1] - raster.top) <= TOLERANCE &&
      Math.abs(box[2] - raster.right) <= TOLERANCE &&
      Math.abs(box[3] - raster.bottom) <= TOLERANCE
    check(
      record.label + ' rasterizer agrees with the evaluator (±' + TOLERANCE + ')',
      agrees,
      (raster.left === null ? 'nothing painted' : formatBox([raster.left, raster.top, raster.right, raster.bottom])) + ' rasterized',
    )
  }
  // Render evidence, so a human can look at the icon at the sizes the UI uses.
  const renderDir = new URL('.tmp-render/', root)
  mkdirSync(renderDir, { recursive: true })
  for (const record of records) {
    if (record.svg === null) continue
    for (const size of [36, 30]) {
      const png = await sharp(record.buffer, { density: 300 })
        .resize(size, size, { fit: 'contain', background: '#f4f6fa' })
        .flatten({ background: '#f4f6fa' })
        .png()
        .toBuffer()
      const stem = record.path.replace(/[\\/]/g, '-').replace(/\.svg$/, '')
      writeFileSync(new URL(`${stem}-${size}.png`, renderDir), png)
    }
    console.log('  wrote .tmp-render/' + record.path.replace(/[\\/]/g, '-').replace(/\.svg$/, '') + '-36.png, -30.png')
  }
}

// ---------------------------------------------------------------- report

console.log('\n-- report')
for (const record of records) {
  if (record.svg === null) continue
  const box = record.footprint
  const viewBox = record.rootAttrs === null ? 'no viewBox' : record.rootAttrs.get('viewbox') || 'no viewBox'
  console.log(
    '  ' +
      record.path.padEnd(16) +
      ' viewBox ' + viewBox.padEnd(11) +
      ' ' + (box === null ? 'footprint none' : 'footprint ' + formatBox(box)).padEnd(48) +
      ' shapes ' + record.shapes +
      '  gradients ' + record.gradients.length +
      '  colors ' + (record.colors.used.length + record.colors.offenders.length) +
      '  ' + record.stat.size + ' B',
  )
}

console.log(failures === 0 ? '\nOK: icon audit passes' + (skipped === 0 ? '' : ' (' + skipped + ' checks skipped)') : '\nFAIL: ' + failures + ' failures')
process.exit(failures === 0 ? 0 : 1)
