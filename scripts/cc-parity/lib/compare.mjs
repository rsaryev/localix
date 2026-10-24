import { byText, canonical } from '../probe/hooks/shape.js'

/**
 * Comparing recordings: two Claude Code versions (`diff`), or Claude Code against Localix (the
 * parity report). A recording is `{ entries: [{ kind, name, shape }] }`; an entry's key is
 * `kind:name`, as in `call:model.fork` or `event:turn.complete`.
 */

const ONE_OF = '$oneOf'
const MISSING = '(missing)'

const keyOf = (entry) => `${entry.kind}:${entry.name}`
const byKey = (recording) =>
  new Map((recording?.entries ?? []).map((entry) => [keyOf(entry), entry]))

const isObject = (shape) =>
  shape !== null && typeof shape === 'object' && !Array.isArray(shape) && !(ONE_OF in shape)

/** A shape's kind in one word: `string`, `object`, `array`, or a union such as `null|string`. */
function kindOf(shape) {
  if (shape === undefined) return MISSING
  if (Array.isArray(shape)) return 'array'
  if (shape && typeof shape === 'object')
    return ONE_OF in shape ? shape[ONE_OF].map(kindOf).join('|') : 'object'
  return shape
}

const fields = (shape) =>
  new Map(
    Object.keys(shape).map((key) => [
      key.replace(/\?$/, ''),
      { shape: shape[key], optional: key.endsWith('?') },
    ]),
  )

/**
 * Where two shapes differ, as `path: a ≠ b` lines. What one side shows only sometimes is a
 * variant the other may not have shown yet, not a difference: a key only one side has as `key?`,
 * and kinds one side's union already holds (`null|string` against `string`).
 */
export function shapeDelta(a, b, path = '') {
  if (canonical(a) === canonical(b)) return []
  const here = path || '(top)'
  if (isObject(a) && isObject(b)) {
    const left = fields(a)
    const right = fields(b)
    const names = [...new Set([...left.keys(), ...right.keys()])].sort(byText)
    return names.flatMap((name) => {
      const at = path ? `${path}.${name}` : name
      const [l, r] = [left.get(name), right.get(name)]
      if (!l || !r) {
        const present = l ?? r
        // A key set to undefined reads as one that is not there.
        if (present.optional || present.shape === 'undefined') return []
        return [`${at}: ${kindOf(l?.shape)} ≠ ${kindOf(r?.shape)}`]
      }
      return shapeDelta(l.shape, r.shape, at)
    })
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    // An empty list shows no element shape: it cannot disagree with one that does.
    if (a.length === 0 || b.length === 0) return []
    return shapeDelta(a[0], b[0], `${path}[]`)
  }
  const union = membersOf(a).length > 1 || membersOf(b).length > 1
  if (union && (within(a, b) || within(b, a))) return []
  return [`${here}: ${kindOf(a)} ≠ ${kindOf(b)}`]
}

const membersOf = (shape) =>
  shape && typeof shape === 'object' && ONE_OF in shape ? shape[ONE_OF] : [shape]

/** Whether every kind `inner` shows is one `outer` shows too: a variant, not a difference. */
const within = (inner, outer) =>
  membersOf(inner).every((one) =>
    membersOf(outer).some((other) => shapeDelta(one, other).length === 0),
  )

export const STATUS = {
  same: 'same',
  different: 'different shape',
  missing: 'missing in Localix',
  unobserved: 'not observed in Claude Code',
}

/**
 * Each entry of either recording, sorted by key: `same`, `different shape` (with the delta and
 * both shapes), `missing in Localix`, or `not observed in Claude Code`. A known gap's reason
 * (`known-gaps.json`) rides along with its entry.
 */
export function parity(claude, localix, { known = {} } = {}) {
  const left = byKey(claude)
  const right = byKey(localix)
  return [...new Set([...left.keys(), ...right.keys()])].sort(byText).map((key) => {
    const [cc, lx] = [left.get(key), right.get(key)]
    const gap = known[key] ? { gap: known[key] } : {}
    if (!lx) return { key, status: STATUS.missing, claude: cc.shape, ...gap }
    if (!cc) return { key, status: STATUS.unobserved, localix: lx.shape, ...gap }
    const delta = shapeDelta(cc.shape, lx.shape)
    if (delta.length === 0) return { key, status: STATUS.same, ...gap }
    return { key, status: STATUS.different, delta, claude: cc.shape, localix: lx.shape, ...gap }
  })
}

/** What changed from one Claude Code recording to the next. */
export function diffSnapshots(older, newer) {
  const before = byKey(older)
  const after = byKey(newer)
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(byText)
  return {
    added: keys.filter((key) => !before.has(key)),
    removed: keys.filter((key) => !after.has(key)),
    changed: keys.flatMap((key) => {
      if (!before.has(key) || !after.has(key)) return []
      const delta = shapeDelta(before.get(key).shape, after.get(key).shape)
      return delta.length ? [{ key, delta }] : []
    }),
  }
}

/** The names that came and went between two surfaces (`*.surface.json`). */
export function diffSurfaces(older, newer) {
  const sections = [
    { section: 'events', label: 'event', member: (name, field) => `${name} field ${field}` },
    { section: 'api', label: 'api', member: (name, method) => `${name}.${method}` },
    {
      section: 'renderSites',
      label: 'render site',
      member: (name, prop) => `${name} prop ${prop}`,
    },
  ]
  return sections.flatMap(({ section, label, member: memberLine }) => {
    const [a, b] = [older?.[section] ?? {}, newer?.[section] ?? {}]
    const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byText)
    const whole = names.flatMap((name) => {
      if (!(name in a)) return [`+ ${label} ${name}`]
      if (!(name in b)) return [`- ${label} ${name}`]
      return []
    })
    const members = names.flatMap((name) => {
      if (!(name in a) || !(name in b)) return []
      const [was, now] = [new Set(a[name]), new Set(b[name])]
      return [
        ...[...now].filter((m) => !was.has(m)).map((m) => `+ ${label} ${memberLine(name, m)}`),
        ...[...was].filter((m) => !now.has(m)).map((m) => `- ${label} ${memberLine(name, m)}`),
      ]
    })
    return [...whole, ...members]
  })
}

/** The parity report as lines a person reads. */
export function formatParity(rows, { checked = [] } = {}) {
  const counts = Object.values(STATUS).map(
    (status) => `${rows.filter((row) => row.status === status).length} ${status}`,
  )
  const lines = [`Localix vs Claude Code: ${counts.join(', ')}`, '']
  for (const row of rows) {
    const mark = checked.includes(row.key) ? ' [checked]' : ''
    lines.push(`${row.status.padEnd(28)} ${row.key}${mark}`)
    for (const line of row.delta ?? []) lines.push(`    ${line}`)
    if (row.status === STATUS.different) {
      lines.push(`    claude code: ${JSON.stringify(row.claude)}`)
      lines.push(`    localix:     ${JSON.stringify(row.localix)}`)
    }
    if (row.gap) lines.push(`    known gap: ${row.gap}`)
  }
  return lines
}
