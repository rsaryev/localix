import { harden, syntaxIntrinsics } from './harden'
import { createSafeConsole } from './safe-console'

/**
 * What a hooks module may reach in its worker, as Claude Code documents a mod: standard
 * JavaScript and web APIs (`URL`, `TextEncoder`, `AbortController`, `crypto.subtle`), and no
 * Node.js or Bun API, no timer globals, no network or file access of its own — `$` is its only
 * door. Run once per worker, before the module's own code:
 *
 * - The module is compiled as a function whose parameters shadow every global not `ALLOWED`, and
 *   `globalThis`, `self` and `global` are a copy of the global object with only those. Its code is
 *   strict, so no function of its own sees the real global object as `this`.
 * - Code cannot be made at run time: the constructors of every kind of function refuse, and `eval`
 *   is gone. The build refuses `import(…)` (`module-build.ts`); compiled as a function, the module
 *   cannot name `import.meta` at all.
 * - What reaches outside or makes code (`DELETED`) is deleted from the global object too. Bun's own
 *   `Bun` cannot be deleted, so it is shadowed only.
 * - Everything the module can reach is frozen (`harden.ts`), so it cannot change what the worker's
 *   own code runs, and its `console` prints only text (`safe-console.ts`).
 */

/**
 * The globals a hooks module gets, by name: standard JavaScript and the web APIs that reach
 * nothing outside the worker. Every other global — what Bun has today (`Bun`, `process`, `fetch`,
 * `Buffer`, timers, `Worker`) and whatever a later Bun adds — is shadowed, so a runtime that grows
 * a global does not grow what a mod reaches. Withheld from standard JavaScript: `eval` and the
 * `Function` constructor (code made at run time), `ShadowRealm` (a fresh realm has every global
 * this one took away), `WebAssembly` (code made at run time), `SharedArrayBuffer` and `Atomics`.
 */
const ALLOWED = new Set(
  `Infinity NaN undefined isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent
  encodeURI encodeURIComponent escape unescape Object Boolean Symbol Error AggregateError EvalError
  RangeError ReferenceError SyntaxError TypeError URIError SuppressedError Number BigInt Math Date
  String RegExp Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array
  Uint32Array Float16Array Float32Array Float64Array BigInt64Array BigUint64Array Map Set WeakMap
  WeakSet WeakRef FinalizationRegistry ArrayBuffer DataView JSON Promise Proxy Reflect Iterator
  DisposableStack AsyncDisposableStack Intl
  URL URLSearchParams URLPattern TextEncoder TextDecoder TextEncoderStream TextDecoderStream atob
  btoa structuredClone AbortController AbortSignal Event EventTarget CustomEvent ErrorEvent
  CloseEvent MessageEvent DOMException crypto Crypto CryptoKey SubtleCrypto Blob File FormData
  Headers Request Response ReadableStream ReadableStreamDefaultReader ReadableStreamBYOBReader
  ReadableStreamBYOBRequest ReadableStreamDefaultController ReadableByteStreamController
  WritableStream WritableStreamDefaultWriter WritableStreamDefaultController TransformStream
  TransformStreamDefaultController ByteLengthQueuingStrategy CountQueuingStrategy
  CompressionStream DecompressionStream navigator performance Performance PerformanceEntry
  PerformanceMark PerformanceMeasure PerformanceObserver PerformanceObserverEntryList
  PerformanceResourceTiming PerformanceServerTiming PerformanceTiming`.split(/\s+/),
)

/**
 * Deleted from the real global object as well as shadowed: what reaches outside the worker, holds
 * it, or makes code. The rest of what is not `ALLOWED` stays for the runtime's own use — `Function`
 * too, which Bun's own modules look up as they load; the module never sees it (`SAFE_FUNCTION`),
 * and the constructor every function inherits refuses.
 */
const DELETED = [
  'process',
  'Bun',
  'fetch',
  'Worker',
  'WebSocket',
  'EventSource',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'HTMLRewriter',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'importScripts',
  'alert',
  'confirm',
  'prompt',
  'ShadowRealm',
  'WebAssembly',
  'SharedArrayBuffer',
  'Atomics',
  'eval',
] as const

/**
 * The worker's own channel and events: shadowed only, since the runtime reports a crash through
 * them, and the module reaches the real global object by no other name.
 */
const CHANNEL = [
  'postMessage',
  'close',
  'onmessage',
  'onmessageerror',
  'onerror',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
] as const

/**
 * Globals the module gets a version of: a callback's throw is reported as the module's crash rather
 * than left to the runtime, whose worker would die of it (and Bun 1.3 with it, in the test runner),
 * and `console` prints text, bounded, without reading the process's input.
 */
const GUARDED = ['queueMicrotask', 'reportError', 'console'] as const

/** The module's own CommonJS wrapper names; the bundle is CommonJS (`module-build.ts`). */
const MODULE_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'] as const

/** Names the module sees as the safe global object. */
const GLOBAL_NAMES = ['globalThis', 'self', 'global'] as const

/** What the compiled module is called with. */
export interface ModuleScope {
  /** The safe global object (`globalThis` in the module). */
  global: Record<PropertyKey, unknown>
  /** The globals a hooks module uses unbound, as in Claude Code: `h` and `Fragment`. */
  unbound: { h: unknown; Fragment: unknown }
}

function refuseCode(): never {
  throw new EvalError('a mod makes no code at run time')
}

function refuseRequire(name: unknown): never {
  throw new Error(
    `require(${JSON.stringify(String(name))}): a hooks module imports only its plugin's files and claude-code`,
  )
}

/** `Function` as the module sees it: `instanceof Function` holds, and calling it refuses. */
const SAFE_FUNCTION = Object.defineProperty(
  function Function() {
    refuseCode()
  },
  'prototype',
  { value: Function.prototype },
)

/**
 * Every global name the module must not see by name: the real global object's own and inherited
 * names that are not `ALLOWED`, and `DELETED` (gone or not). `eval` cannot be a strict parameter;
 * it is deleted instead (`lockDown`).
 */
function withheldNames(): string[] {
  const names = new Set<string>(DELETED)
  for (
    let at: object | null = globalThis;
    at && at !== Object.prototype;
    at = Object.getPrototypeOf(at)
  )
    for (const key of Object.getOwnPropertyNames(at)) names.add(key)
  return [...names].filter((one) => !ALLOWED.has(one) && one !== 'eval' && isParameterName(one))
}

function isParameterName(name: string): boolean {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false
  try {
    new Function(name, '"use strict"')
    return true
  } catch {
    return false
  }
}

/**
 * The bundle as a function of its scope, compiled now — before `lockDown` takes the means away —
 * and run when called. Its `register` export is what it answers.
 */
export function compileHooksBundle(code: string, name: string) {
  const named = new Set<string>([
    ...CHANNEL,
    ...GLOBAL_NAMES,
    ...GUARDED,
    'Function',
    'h',
    'Fragment',
    ...MODULE_PARAMS,
  ])
  const withheld = withheldNames().filter((one) => !named.has(one))
  const params = [...withheld, ...named]
  // A block, so a module's own top-level `const fetch` shadows the parameter, not clashes with it.
  const body = `"use strict";\n{\n${code}\n}\n//# sourceURL=${name.replace(/\s/g, '_')}`
  const compiled = new Function(...params, body) as (...args: unknown[]) => void
  return (scope: ModuleScope): Record<string, unknown> => {
    const module = { exports: {} as Record<string, unknown> }
    compiled(
      ...[...withheld, ...CHANNEL].map(() => undefined),
      ...GLOBAL_NAMES.map(() => scope.global),
      ...GUARDED.map((name) => scope.global[name] ?? (globalThis as Record<string, unknown>)[name]),
      SAFE_FUNCTION,
      scope.unbound.h,
      scope.unbound.Fragment,
      module.exports,
      refuseRequire,
      module,
      '',
      '',
    )
    return module.exports
  }
}

/**
 * Takes away what a hooks module may not reach in this realm, and answers the global object it
 * sees: the real one's members less the withheld, with `extra` (the `claude-code` runtime). A
 * throw the module's code leaves uncaught goes to `crashed`.
 */
export function lockDown(
  extra: Record<PropertyKey, unknown>,
  crashed: (error: unknown) => void,
): Record<PropertyKey, unknown> {
  warmRuntime()
  const real = globalThis as unknown as Record<PropertyKey, unknown>
  const safe: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(real)) {
    if (typeof key === 'string' && !ALLOWED.has(key)) continue
    const value = real[key]
    // A web API called as `globalThis.atob(…)` needs the real global object as its receiver.
    safe[key] =
      typeof value === 'function' && typeof key === 'string' && /^[a-z]/.test(key)
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value
  }
  const enqueue = queueMicrotask
  Object.assign(safe, extra, {
    Function: SAFE_FUNCTION,
    queueMicrotask(callback: unknown) {
      if (typeof callback !== 'function') throw new TypeError('queueMicrotask takes a function')
      enqueue(() => {
        try {
          callback()
        } catch (error) {
          crashed(error)
        }
      })
    },
    reportError: crashed,
    console: createSafeConsole({
      print: (level, line) => (level === 'error' ? console.error(line) : console.log(line)),
      now: Date.now,
    }),
  })
  for (const name of GLOBAL_NAMES) safe[name] = safe

  const kinds = [function () {}, async function () {}, function* () {}, async function* () {}]
  for (const kind of kinds)
    Object.defineProperty(Object.getPrototypeOf(kind), 'constructor', {
      value: refuseCode,
      writable: false,
      configurable: false,
    })
  // A stack frame's receiver and function stay out of reach (`CallSite.getThis`).
  Object.defineProperty(Error, 'prepareStackTrace', {
    value: undefined,
    writable: false,
    configurable: false,
  })
  for (const name of DELETED)
    try {
      delete real[name]
    } catch {
      // Not configurable (`Bun`): shadowed only.
    }
  // The safe global itself stays the module's to add to; what it holds, and what it reaches, not.
  harden(
    [...Reflect.ownKeys(safe).map((key) => safe[key]), ...syntaxIntrinsics()].filter(
      (value) => value !== safe,
    ),
  )
  return safe
}

/**
 * Loads what Bun loads lazily — its streams, compression, `Response` bodies, `structuredClone`,
 * `URLPattern`, `Intl` — while the global object is still whole, so its own modules never load
 * into a locked-down one.
 */
function warmRuntime() {
  const chunks = new Blob(['x'])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextEncoderStream())
  void new Response(chunks).text().catch(() => {})
  void crypto.subtle.digest('SHA-256', new Uint8Array(1)).catch(() => {})
  structuredClone({ at: new Date(0), list: [new Map(), new Set()] })
  new URLPattern({ pathname: '/' }).test('http://localhost/')
  new Intl.DateTimeFormat('en').format(0)
  new FormData().append('key', 'value')
}
