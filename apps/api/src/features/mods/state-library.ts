/**
 * The state helpers `claude-code` exports — `atom`, `read`, `update`, `derive`, `memberOf` — as
 * the JavaScript a bundled module (hooks or surface) gets with its `import … from 'claude-code'`.
 * They are Claude Code's own: pure functions over `$.state` (`api/state-api.ts`), so the same
 * source runs in the API process and in a surface module's frame.
 *
 * - `atom(ref, initial, { shape? })` names a value and its default (a stored value of another
 *   `shape` reads as the default).
 * - `read($, source)` resolves to an atom's, a reference's or a derived value's current value.
 * - `update($, target, change)` writes `change(current)`, again if another write came between.
 * - `derive([sources], compute)` computes from other sources, again only when one changed.
 * - `memberOf(family, e)` is the member of a family (an atom or a reference) for `e.requestId`.
 */
export const STATE_LIBRARY = `
const ATOM_BRAND = Symbol.for('claude-code.state.atom')
const DERIVED_BRAND = Symbol.for('claude-code.state.derived')
const UPDATE_TRIES_MAX = 64
function frozenRef(ref, id = ref.id) {
  const { plugin, key } = ref
  return Object.freeze(id === undefined ? { plugin, key } : { plugin, key, id })
}
function deepFrozen(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const member of Object.values(value)) deepFrozen(member)
  return Object.freeze(value)
}
const hasBrand = (source, brand) =>
  typeof source === 'object' && source !== null && source[brand] !== undefined
const isAtom = (source) => hasBrand(source, ATOM_BRAND)
const isDerived = (source) => hasBrand(source, DERIVED_BRAND)
function atomValueOf(atom, stored) {
  if (atom.shape === undefined) return stored === undefined ? atom.initial : stored
  const isSameShape = stored?.shape === atom.shape && stored.value !== undefined
  return isSameShape ? stored.value : atom.initial
}
const storedValueOf = (atom, value) =>
  atom.shape === undefined ? value : { shape: atom.shape, value }
export const atom = (ref, initial, options) =>
  Object.freeze({
    [ATOM_BRAND]: true,
    ref: frozenRef(ref),
    initial: deepFrozen(initial),
    ...(options?.shape !== undefined && { shape: options.shape }),
  })
export const derive = (sources, compute) =>
  Object.freeze({
    [DERIVED_BRAND]: {},
    sources: Object.freeze(
      sources.map((one) => (isAtom(one) || isDerived(one) ? one : frozenRef(one))),
    ),
    compute,
  })
export const memberOf = (family, e) =>
  isAtom(family)
    ? Object.freeze({ ...family, [ATOM_BRAND]: true, ref: frozenRef(family.ref, e.requestId) })
    : frozenRef(family, e.requestId)
async function peek(state, source) {
  if (isAtom(source)) {
    const held = await state.get(source.ref)
    return { value: atomValueOf(source, held.value), versions: [held.version] }
  }
  if (!isDerived(source)) {
    const held = await state.get(source)
    return { value: held.value, versions: [held.version] }
  }
  const parts = await Promise.all(source.sources.map((one) => peek(state, one)))
  const versions = parts.flatMap((part) => part.versions)
  const key = versions.join(',')
  const memo = source[DERIVED_BRAND]
  if (memo.versions !== key) {
    memo.value = source.compute(...parts.map((part) => part.value))
    memo.versions = key
  }
  return { value: memo.value, versions }
}
export const read = async ($, source) => (await peek($.state, source)).value
export const update = async ($, target, change) => {
  const ref = isAtom(target) ? target.ref : target
  for (let tries = 0; tries < UPDATE_TRIES_MAX; tries += 1) {
    const held = await $.state.get(ref)
    const current = isAtom(target) ? atomValueOf(target, held.value) : held.value
    const next = change(current)
    const value = isAtom(target) ? storedValueOf(target, next) : next
    const wrote = await $.state.set({ ...ref, value, ifVersion: held.version })
    if (wrote.isSet) return next
  }
  throw new Error(
    'update: the value was written by another every time it was read, up to the bound on ' +
      'tries; nothing was written',
  )
}
`
