/**
 * Shape descriptors: what a value looks like, never what it holds. A primitive is its kind
 * (`'string'`, `'number'`, `'boolean'`, `'null'`, `'undefined'`, `'function'`); an object is its
 * keys, sorted, each with its own shape; an array is `[]` when empty, else `[shape]`, the shape of
 * its elements merged. Values that differ in kind merge into `{ $oneOf: [...] }`, and a key one
 * observation has and another lacks is kept as `'key?'`. Past `depth` levels an object or array is
 * `'object'` or `'array'`, so a record keyed by data (file paths, settings) is never spelled out.
 * No string, number or other value of the input ever reaches a descriptor.
 */

export const REJECTED = '<rejected>'
const ONE_OF = '$oneOf'

/** Text order by code unit, the same everywhere. */
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const isPlain = (shape) =>
  shape !== null && typeof shape === 'object' && !Array.isArray(shape) && !(ONE_OF in shape)

/** The shape of `value`, objects expanded `depth` levels deep. */
export function describe(value, depth = 6) {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (depth <= 0) return 'array'
    if (value.length === 0) return []
    return [value.map((item) => describe(item, depth - 1)).reduce(mergeShape)]
  }
  if (typeof value !== 'object') return typeof value
  if (depth <= 0) return 'object'
  const shape = {}
  for (const key of Object.keys(value).sort()) shape[key] = describe(value[key], depth - 1)
  return shape
}

const bare = (key) => (key.endsWith('?') ? key.slice(0, -1) : key)

/** Two observations of one thing as one shape. */
export function mergeShape(a, b) {
  if (sameShape(a, b)) return a
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === 0) return b
    if (b.length === 0) return a
    return [mergeShape(a[0], b[0])]
  }
  if (isPlain(a) && isPlain(b)) return mergeObjects(a, b)
  return oneOf([...members(a), ...members(b)])
}

function mergeObjects(a, b) {
  const keys = new Map()
  for (const [source, other] of [
    [a, b],
    [b, a],
  ])
    for (const key of Object.keys(source)) {
      const name = bare(key)
      const optional = key.endsWith('?') || !(name in other || `${name}?` in other)
      const shape = source[key]
      const seen = keys.get(name)
      keys.set(name, {
        optional: (seen?.optional ?? false) || optional,
        shape: seen ? mergeShape(seen.shape, shape) : shape,
      })
    }
  const merged = {}
  for (const name of [...keys.keys()].sort(byText))
    merged[keys.get(name).optional ? `${name}?` : name] = keys.get(name).shape
  return merged
}

const members = (shape) =>
  shape && typeof shape === 'object' && ONE_OF in shape ? shape[ONE_OF] : [shape]

/** A union: one object member and one array member at most, each merged, sorted. */
function oneOf(list) {
  let object
  let array
  const rest = []
  for (const shape of list) {
    if (isPlain(shape)) object = object ? mergeObjects(object, shape) : shape
    else if (Array.isArray(shape)) array = array ? mergeShape(array, shape) : shape
    else if (!rest.includes(shape)) rest.push(shape)
  }
  const all = [...rest.sort(byText), ...(array ? [array] : []), ...(object ? [object] : [])]
  return all.length === 1 ? all[0] : { [ONE_OF]: all }
}

/** Whether two shapes are the same, key order aside. */
export function sameShape(a, b) {
  return canonical(a) === canonical(b)
}

export function canonical(shape) {
  if (shape === null || typeof shape !== 'object') return JSON.stringify(shape)
  if (Array.isArray(shape)) return `[${shape.map(canonical).join(',')}]`
  return `{${Object.keys(shape)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(shape[key])}`)
    .join(',')}}`
}
