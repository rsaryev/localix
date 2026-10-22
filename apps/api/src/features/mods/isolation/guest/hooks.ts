import {
  Fragment,
  freezeDeep,
  h,
  isHookBody,
  matchesEvent,
  plainDataProblem,
  type Matcher,
} from '@localixai/claude-plugin/mods'
import type { CallInput, HookSpecWire } from '../call-protocol'
import type { createGuestApi } from './dollar'

/**
 * The hooks module inside its VM: `load` evaluates the module the host sent as text — never read
 * from disk, where the mod could have written — as a CommonJS function body, and runs its
 * `register`; from then on `call` runs the hook the host names, with a `$` and a `next` that go
 * back to the host (`dollar.ts`). A generator hook's stream stays here, read by `step` and closed
 * by `end`. A matcher the host cannot hold as plain data (a RegExp) is matched here.
 */

type Fn = (...args: unknown[]) => unknown

/** The module's own CommonJS wrapper, and the JSX factory globals of a Claude Code hooks module. */
const MODULE_PARAMS = 'exports, require, module, __filename, __dirname, h, Fragment'

function refuseRequire(name: unknown): never {
  throw new Error(
    `require(${JSON.stringify(String(name))}): a hooks module imports only its plugin's files and claude-code`,
  )
}

/** The matcher as it is now, RegExps included: a getter or a later change counts not. */
function copyMatcher(value: unknown, event: string, depth = 0): unknown {
  if (depth > 32) throw new Error(`on("${event}"): the matcher nests too deep`)
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  if (typeof value === 'function')
    throw new TypeError(`on("${event}"): a matcher holds no function`)
  if (Array.isArray(value)) return value.map((item) => copyMatcher(item, event, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const copy: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) copy[key] = copyMatcher(field, event, depth + 1)
  return copy
}

const isPlainMatcher = (matcher: unknown) =>
  typeof matcher === 'object' &&
  matcher !== null &&
  !Array.isArray(matcher) &&
  plainDataProblem(matcher) === null

const GENERATOR = Object.getPrototypeOf(async function* () {}) as object
const isGenerator = (fn: unknown) =>
  typeof fn === 'function' && Object.getPrototypeOf(fn) === GENERATOR

const isThenable = (value: unknown) =>
  !!value && typeof (value as { then?: unknown }).then === 'function'

async function drain(body: AsyncGenerator<unknown, unknown, unknown>) {
  for (;;) {
    const step = await body.next()
    if (step.done) return step.value
  }
}

export function createGuestHooks(input: {
  api: ReturnType<typeof createGuestApi>
  evaluate: (source: string, name: string) => unknown
}) {
  const { api } = input
  const hooks = new Map<number, Fn>()
  /** A hook's matcher the host cannot hold as plain data (a RegExp): it is matched here. */
  const matchedHere = new Map<number, Matcher>()
  /** Generator hooks the host is reading, with the call each one serves. */
  const streams = new Map<
    number,
    { body: AsyncGenerator<unknown, unknown, unknown>; call: number }
  >()
  let lastId = 0
  let loaded = false

  const keep = (fn: Fn) => {
    const id = ++lastId
    hooks.set(id, fn)
    return id
  }

  /** `register`'s `on`: each hook kept by id, and described to the host as data. */
  function onFor(specs: HookSpecWire[]) {
    return (event: unknown, matcherOrHook: unknown, hook?: unknown) => {
      if (typeof event !== 'string') throw new TypeError('on() takes an event name first')
      const fn = typeof matcherOrHook === 'function' ? matcherOrHook : hook
      if (typeof fn !== 'function') throw new Error(`on("${event}") needs a hook function`)
      const id = keep(fn as Fn)
      const spec: HookSpecWire = { id, event, generator: isGenerator(fn) }
      if (typeof matcherOrHook !== 'function' && matcherOrHook != null) {
        const matcher = copyMatcher(matcherOrHook, event) as Matcher
        if (isPlainMatcher(matcher)) spec.matcher = matcher
        else {
          // The host matches every event of the name; the hook answers as absent when this misses.
          matchedHere.set(id, matcher)
          spec.matcher = {}
        }
      }
      specs.push(spec)
      const registration = {
        catch(handler: unknown) {
          if (typeof handler === 'function')
            spec.onError = { id: keep(handler as Fn), generator: isGenerator(handler) }
          return registration
        },
      }
      return registration
    }
  }

  return {
    async load(code: unknown, name: unknown, options: unknown) {
      if (loaded) throw new Error('this VM has loaded its module already')
      loaded = true
      if (typeof code !== 'string') throw new Error('load carries the module as text')
      const source = `(function (${MODULE_PARAMS}) {"use strict";\n{\n${code}\n}\n})`
      const factory = input.evaluate(source, typeof name === 'string' ? name : 'hooks.cjs')
      if (typeof factory !== 'function') throw new Error('the hooks module did not compile')
      const module = { exports: {} as Record<string, unknown> }
      ;(factory as Fn)(module.exports, refuseRequire, module, '', '', h, Fragment)
      const register = module.exports.register
      if (typeof register !== 'function')
        throw new Error('The hooks module does not export a register function')
      const specs: HookSpecWire[] = []
      await (register as Fn)(onFor(specs), options)
      return { hooks: specs }
    },

    async call(call: CallInput) {
      const hook = hooks.get(call.hook)
      if (!hook) throw new Error('no such hook')
      const matcher = matchedHere.get(call.hook)
      if (matcher && !matchesEvent(matcher, call.e)) {
        api.ended(call.call)
        return { absent: true }
      }
      const $ = api.dollar(call.call, call.shape)
      const next = api.next(call.call, call.next)
      let streaming = false
      try {
        const answer = hook($, freezeDeep(call.e), next)
        if (isGenerator(hook) && isHookBody(answer)) {
          const id = ++lastId
          streams.set(id, { body: answer, call: call.call })
          streaming = true
          return { stream: id }
        }
        // A plain hook that handed back a stream answers what the stream returns.
        if (isHookBody(answer) && !isThenable(answer)) return { value: await drain(answer) }
        return { value: await answer }
      } finally {
        // A generator's call ends with its stream (`step`, `end`).
        if (!streaming) api.ended(call.call)
      }
    },

    async step(id: number) {
      const stream = streams.get(id)
      if (!stream) throw new Error('the hook stream ended')
      const step = await stream.body.next()
      if (step.done) {
        streams.delete(id)
        api.ended(stream.call)
      }
      return { done: step.done === true, value: step.value }
    },

    end(id: number) {
      const stream = streams.get(id)
      if (!stream) return
      streams.delete(id)
      api.ended(stream.call)
      void stream.body.return(undefined).catch(() => {})
    },
  }
}
