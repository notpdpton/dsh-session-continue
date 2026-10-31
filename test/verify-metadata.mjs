/**
 * Simulate the plugin manager's display-metadata reader against this package.
 *
 * Reproduces `readPluginMeta` closely enough to catch the failures that are
 * invisible to a plain JSON check: everything is resolved through Node's package
 * exports, exactly as the manager does, so an `exports` gap that hides
 * `package.json` or a locale file shows up here instead of on the Plugins page.
 *
 * The manager's fallback chain is: locale dictionary -> package.json fields ->
 * the package name. A missing locale must therefore still yield a title, and a
 * broken `package.json` export must be caught before it silently degrades the
 * whole row to the bare package name.
 *
 * usage: node verify-metadata.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url)
const require = createRequire(root)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const name = pkg.name

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Resolve a plugin resource through the package exports, or undefined. */
function resolveResource(specifier) {
  try {
    return require.resolve(specifier)
  } catch {
    return undefined
  }
}

/** Mirror of the reader: locale dictionaries plus the manifest fallbacks. */
function readMeta(specifier) {
  const englishPath = resolveResource(`${specifier}/locale/en.json`)
  const dictionaries = new Map()
  if (englishPath !== undefined) {
    // The reader lists the locale DIRECTORY of the resolved English dictionary, so
    // a locale file the exports map does not whitelist is invisible to it. Build
    // the directory URL from the resolved file so Windows separators never reach
    // the URL parser.
    const localeDir = new URL('.', pathToFileURL(englishPath))
    for (const entry of readdirSync(localeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const locale = entry.name.slice(0, -'.json'.length)
      try {
        dictionaries.set(locale, JSON.parse(readFileSync(new URL(entry.name, localeDir), 'utf8')))
      } catch {
        // A malformed dictionary is skipped, exactly like the real reader.
      }
    }
  }

  const manifestPath = resolveResource(`${specifier}/package.json`)
  const manifest = manifestPath === undefined ? undefined : JSON.parse(readFileSync(manifestPath, 'utf8'))
  const iconPath = resolveResource(`${specifier}/icon`)

  return {
    specifier,
    name: manifest?.name ?? specifier,
    version: manifest?.version,
    icon: iconPath,
    title(locale) {
      const dict = dictionaries.get(locale) ?? dictionaries.get('en')
      return dict?.meta?.title ?? manifest?.description ?? this.name
    },
    description(locale) {
      const dict = dictionaries.get(locale) ?? dictionaries.get('en')
      return dict?.meta?.description ?? manifest?.description ?? ''
    },
    locales: [...dictionaries.keys()].sort(),
  }
}

console.log('-- reader simulation')
const meta = readMeta(name)
check('the reader finds the manifest', meta.name === pkg.name, meta.name)
check('the reader finds the version', meta.version === pkg.version, String(meta.version))
check('the reader finds the icon', meta.icon !== undefined && meta.icon.endsWith('icon.svg'), String(meta.icon))
check('the reader finds both locales', meta.locales.join(',') === 'en,zh', meta.locales.join(','))

console.log('\n-- displayed strings')
check('zh title comes from the dictionary', meta.title('zh') === '会话中断继续', meta.title('zh'))
check('en title comes from the dictionary', meta.title('en') === 'Session recovery', meta.title('en'))
check('zh description comes from the dictionary', meta.description('zh').includes('继续'), meta.description('zh'))
check('en description comes from the dictionary', meta.description('en').includes('Continue'), meta.description('en'))
// The fallback chain must never be what the user actually sees: if a dictionary
// is missing, the row silently degrades to the manifest description.
check('the zh title is not the manifest fallback', meta.title('zh') !== pkg.description, meta.title('zh'))
check('an unknown locale falls back to English', meta.title('fr') === meta.title('en'), meta.title('fr'))
check('a missing dictionary still yields a title', readMeta('node:fs').title('zh').length > 0)

console.log('\n-- dictionaries are well formed')
for (const locale of ['zh', 'en']) {
  const dict = JSON.parse(readFileSync(new URL(`locale/${locale}.json`, root), 'utf8'))
  check(`${locale} title is a non-empty string`, typeof dict.meta?.title === 'string' && dict.meta.title.trim().length > 0, JSON.stringify(dict.meta?.title))
  check(`${locale} description is a non-empty string`, typeof dict.meta?.description === 'string' && dict.meta.description.trim().length > 0)
  check(`${locale} has no other top-level keys`, Object.keys(dict).length === 1 && 'meta' in dict, Object.keys(dict).join(','))
  check(`${locale} has no other meta keys`, Object.keys(dict.meta).every((key) => key === 'title' || key === 'description'), Object.keys(dict.meta).join(','))
}
check('zh and en describe the same package (titles differ)', meta.title('zh') !== meta.title('en'))

console.log(failures === 0 ? '\nOK: display metadata audit passes' : `\nFAIL: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)