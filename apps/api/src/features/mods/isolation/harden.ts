/**
 * HARDENING, as SES does it: after the worker's own code captured what it needs and before a hooks
 * module runs, everything the module can reach is frozen — the safe global's values, and the
 * intrinsics it can reach only by syntax (the prototypes of functions, generators, iterators) —
 * so the module cannot change what the worker's own code relies on. A getter redefined on
 * `MessageEvent.prototype`, run by the worker's listener with the real global as its `this`, is
 * the escape this closes; `Object.prototype.then` is another.
 *
 * Freezing a prototype makes assigning one of its names to an object that inherits it throw (the
 * "override mistake": `error.name = …`, `obj.toString = …`). As SES does, the names commonly
 * assigned become accessors on each prototype: reading answers the original, and assigning to an
 * object that inherits it defines the object's own property.
 */

/** Names a module's own objects commonly assign over an inherited one (SES's enablements). */
const OVERRIDDEN: readonly PropertyKey[] = [
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'toJSON',
  'name',
  'message',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'push',
  'concat',
  'bind',
  'apply',
  'call',
  Symbol.iterator,
  Symbol.asyncIterator,
]

type Reachable = object

const isReachable = (value: unknown): value is Reachable =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

/**
 * Intrinsics a module reaches by syntax or by calling a web API, not by a global's name: function
 * kinds, generators and iterators of every built-in kind.
 */
export function syntaxIntrinsics(): unknown[] {
  const iterators: unknown[] = [
    [][Symbol.iterator](),
    new Map().entries(),
    new Set().values(),
    ''[Symbol.iterator](),
    /a/g[Symbol.matchAll]('a'),
    new URLSearchParams().entries(),
    new Headers().entries(),
    new FormData().entries(),
    (function* () {})(),
    (async function* () {})(),
  ]
  const from = (globalThis as { Iterator?: { from?: (it: unknown) => Iterator<unknown> } }).Iterator
    ?.from
  const helper = from?.([]) as { map?: (f: (x: unknown) => unknown) => unknown } | undefined
  if (helper?.map) iterators.push(helper.map((x) => x))
  return [
    function () {},
    async function () {},
    function* () {},
    async function* () {},
    async () => {},
    (async () => {})(),
    ...iterators,
  ]
}

/** Every object reachable from `roots`, through own properties, accessors and prototypes. */
function reachableFrom(roots: readonly unknown[]): {
  all: Set<Reachable>
  prototypes: Set<Reachable>
} {
  const all = new Set<Reachable>()
  const prototypes = new Set<Reachable>()
  const queue: Reachable[] = []
  const visit = (value: unknown) => {
    if (!isReachable(value) || all.has(value)) return
    all.add(value)
    queue.push(value)
  }
  for (const root of roots) visit(root)
  while (queue.length > 0) {
    const at = queue.pop()!
    const prototype = Object.getPrototypeOf(at) as unknown
    if (isReachable(prototype)) {
      prototypes.add(prototype)
      visit(prototype)
    }
    for (const key of Reflect.ownKeys(at)) {
      const field = Reflect.getOwnPropertyDescriptor(at, key)
      if (!field) continue
      if ('value' in field) {
        visit(field.value)
        if (key === 'prototype' && typeof at === 'function' && isReachable(field.value))
          prototypes.add(field.value)
      } else {
        visit(field.get)
        visit(field.set)
      }
    }
  }
  return { all, prototypes }
}

/** `key` of `prototype` as an accessor an inheriting object may assign over (see above). */
function tame(prototype: Reachable, key: PropertyKey, frozen: Set<Reachable>) {
  const field = Reflect.getOwnPropertyDescriptor(prototype, key)
  if (!field || !('value' in field) || !field.writable || !field.configurable) return
  const value: unknown = field.value
  const accessor = {
    get() {
      return value
    },
    set(this: unknown, next: unknown) {
      if (this === prototype)
        throw new TypeError(`Cannot assign to ${String(key)} of a frozen intrinsic`)
      Object.defineProperty(this, key, {
        value: next,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    },
  }
  Object.defineProperty(prototype, key, {
    get: accessor.get,
    set: accessor.set,
    enumerable: field.enumerable === true,
    configurable: false,
  })
  frozen.add(accessor.get)
  frozen.add(accessor.set)
}

/**
 * Freezes everything reachable from `roots` (see above). Throws when something stays mutable: a
 * module that could change it must not run.
 */
export function harden(roots: readonly unknown[]): void {
  const { all, prototypes } = reachableFrom(roots)
  for (const prototype of prototypes) {
    const keys = prototype === Object.prototype ? Reflect.ownKeys(prototype) : OVERRIDDEN
    for (const key of keys) tame(prototype, key, all)
  }
  const unfrozen: string[] = []
  for (const value of all) {
    try {
      Object.freeze(value)
    } catch {
      // Checked below.
    }
    if (!Object.isFrozen(value)) unfrozen.push(describe(value))
  }
  if (unfrozen.length > 0)
    throw new Error(`hardening left ${unfrozen.slice(0, 5).join(', ')} mutable`)
}

function describe(value: Reachable): string {
  try {
    return typeof value === 'function'
      ? `function ${value.name}`
      : Object.prototype.toString.call(value)
  } catch {
    return typeof value
  }
}
