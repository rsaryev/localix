/**
 * THE WORKER a mod instance runs in (`mod-worker.ts` starts it). Importing this module starts it:
 * it waits for `load`, which carries the hooks module's code — never read from disk, where the mod
 * could have written — compiles it, takes away what a mod may not reach (`lockdown.ts`), runs the
 * module and its `register`, and from then on runs the hooks the host calls. Every `$` call and
 * every `next` goes back to the host (`worker-api.ts`). A `ping` is answered at once, so a host
 * that hears nothing knows the module holds the thread.
 */
import {
  Fragment,
  freezeDeep,
  h,
  isHookBody,
  matchesEvent,
  plainDataProblem,
  type Matcher,
} from '@localixai/claude-plugin/mods'
import { createEndpoint, type Message } from './endpoint'
import { compileHooksBundle, lockDown } from './lockdown'
import { createWorkerApi, type CallMeta, type ApiShape } from './worker-api'

type Fn = (...args: unknown[]) => unknown

interface HookSpec {
  id: number
  event: string
  matcher?: unknown
  generator: boolean
  onError?: { id: number; generator: boolean }
}

const scope = globalThis as unknown as {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}
const post = scope.postMessage.bind(globalThis)
const hooks = new Map<number, Fn>()
/** A hook's matcher the host cannot hold as plain data (a RegExp): it is matched here. */
const matchedHere = new Map<number, Matcher>()
/** Generator hooks the host is reading, with the call each one serves. */
const streams = new Map<number, { body: AsyncGenerator<unknown, unknown, unknown>; call: number }>()
let lastId = 0
let loaded = false

const endpoint = createEndpoint({
  post: (message) => post(message),
  handlers: {
    load: (({ code, name, options }: { code: unknown; name: unknown; options: object }) =>
      load(code, name, options as Record<string, unknown>)) as never,
    call: ((input: CallInput) => call(input)) as never,
    step: (async ({ id }: { id: number }) => {
      const stream = streams.get(id)
      if (!stream) throw new Error('the hook stream ended')
      const step = await stream.body.next()
      if (step.done) {
        streams.delete(id)
        api.ended(stream.call)
      }
      return { done: step.done === true, value: step.value }
    }) as never,
    end: (({ id }: { id: number }) => {
      const stream = streams.get(id)
      if (!stream) return
      streams.delete(id)
      api.ended(stream.call)
      void stream.body.return(undefined).catch(() => {})
    }) as never,
    abort: (({ call }: { call: number }) => api.abort(call)) as never,
    tables: (({ tables }: { tables: Record<string, Record<string, unknown>> }) =>
      api.setTables(tables)) as never,
  },
})
const api = createWorkerApi(endpoint)

// A rejection nothing handled is the mod's to know about; a throw outside any call is a crash.
process.on('unhandledRejection', (reason) =>
  endpoint.notify('report', { message: `unhandled rejection: ${messageOf(reason)}` }),
)
const crash = (error: unknown) => endpoint.notify('crash', { message: messageOf(error) })
process.on('uncaughtException', crash)

scope.addEventListener('message', (event) => {
  const message = event.data as Message | { t: 'ping' }
  if (message.t === 'ping') post({ t: 'pong' })
  else endpoint.receive(message)
})
post({ t: 'ready' })

async function load(code: unknown, name: unknown, options: Record<string, unknown>) {
  if (loaded) throw new Error('this worker has loaded its module already')
  loaded = true
  if (typeof code !== 'string') throw new Error('load carries the module as text')
  const run = compileHooksBundle(code, typeof name === 'string' ? name : 'hooks.cjs')
  const global = lockDown({ [Symbol.for('localix.mods.claude-code')]: { h, Fragment } }, crash)
  const exports = run({ global, unbound: { h, Fragment } })
  const register = exports.register
  if (typeof register !== 'function')
    throw new Error('The hooks module does not export a register function')
  const specs: HookSpec[] = []
  const keep = (fn: Fn) => {
    const id = ++lastId
    hooks.set(id, fn)
    return id
  }
  const on = (event: unknown, matcherOrHook: unknown, hook?: unknown) => {
    if (typeof event !== 'string') throw new TypeError('on() takes an event name first')
    const fn = typeof matcherOrHook === 'function' ? matcherOrHook : hook
    if (typeof fn !== 'function') throw new Error(`on("${event}") needs a hook function`)
    const id = keep(fn as Fn)
    const spec: HookSpec = { id, event, generator: isGenerator(fn) }
    if (typeof matcherOrHook !== 'function' && matcherOrHook != null) {
      // A copy as it is now: a getter or a later change of the module's own object counts not.
      const matcher = structuredClone(matcherOrHook) as Matcher
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
  await (register as Fn)(on, options)
  return { hooks: specs }
}

const isPlainMatcher = (matcher: unknown) =>
  typeof matcher === 'object' &&
  matcher !== null &&
  !Array.isArray(matcher) &&
  plainDataProblem(matcher) === null

interface CallInput {
  hook: number
  call: number
  e: unknown
  shape: ApiShape
  next: CallMeta
}

async function call(input: CallInput) {
  const hook = hooks.get(input.hook)
  if (!hook) throw new Error('no such hook')
  const matcher = matchedHere.get(input.hook)
  if (matcher && !matchesEvent(matcher, input.e)) {
    api.ended(input.call)
    return { absent: true }
  }
  const $ = api.dollar(input.call, input.shape)
  const next = api.next(input.call, input.next)
  let streaming = false
  try {
    const answer = hook($, freezeDeep(input.e), next)
    if (isGenerator(hook) && isHookBody(answer)) {
      const id = ++lastId
      streams.set(id, { body: answer, call: input.call })
      streaming = true
      return { stream: id }
    }
    // A plain hook that handed back a stream answers what the stream returns.
    if (isHookBody(answer) && !isThenable(answer)) return { value: await drain(answer) }
    return { value: await answer }
  } finally {
    // A generator's call ends with its stream (`step`, `end`).
    if (!streaming) api.ended(input.call)
  }
}

async function drain(body: AsyncGenerator<unknown, unknown, unknown>) {
  for (;;) {
    const step = await body.next()
    if (step.done) return step.value
  }
}

const GENERATOR = Object.getPrototypeOf(async function* () {}) as object
const isGenerator = (fn: unknown) =>
  typeof fn === 'function' && Object.getPrototypeOf(fn) === GENERATOR

const isThenable = (value: unknown) =>
  !!value && typeof (value as { then?: unknown }).then === 'function'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
