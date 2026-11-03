/**
 * A caret-range evaluator, because this package has no dependencies.
 *
 * `verify-manifest.mjs` has to answer "does the host version this plugin declares
 * actually admit the hosts it was verified on", and that is a semver range question.
 * Pulling in `semver` to answer it would give a zero-dependency plugin a dependency
 * of its own — the one thing its manifest promises not to have.
 *
 * So this implements the SINGLE range shape the manifest is allowed to use, and
 * `verify-manifest.mjs` rejects any other shape rather than silently mis-evaluating
 * it. The arithmetic is cross-checked against real `semver` in `verify-manifest.mjs`
 * whenever npm's copy happens to be resolvable, and the checked-in expectations are
 * the ones asserted when it is not.
 *
 * usage: imported by verify-manifest.mjs
 */

function parseVersion(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value).trim());
  if (m === null) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? [] : m[4].split('.') };
}
/** Compare prerelease identifiers per semver: numeric ranks below alphanumeric, shorter first. */
function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;   // a release outranks all of its prereleases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const x = a[i], y = b[i];
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d < 0 ? -1 : 1; continue; }
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  return comparePre(a.pre, b.pre);
}
/**
 * \`^X.Y.Z\` with includePrerelease.
 *
 * The upper bound carries the \`-0\` prerelease exactly as semver's own
 * \`replaceCaret\` writes it: \`<0.3.0-0\`, not \`<0.3.0\`. Without it,
 * \`0.3.0-rc.1\` would be admitted by \`^0.2.1-rc.5\`, which real semver refuses.
 */
function satisfiesCaret(version, range) {
  const r = /^\^(.+)$/.exec(range);
  if (r === null) return null;                 // not a caret range: caller must reject
  const floor = parseVersion(r[1]);
  const v = parseVersion(version);
  if (floor === null || v === null) return null;
  const ceil = floor.nums[0] > 0
    ? [floor.nums[0] + 1, 0, 0]
    : floor.nums[1] > 0
      ? [0, floor.nums[1] + 1, 0]
      : [0, 0, floor.nums[2] + 1];
  if (compareVersion(v, floor) < 0) return false;
  return compareVersion(v, { nums: ceil, pre: ['0'] }) < 0;
}
export { parseVersion, compareVersion, satisfiesCaret };
