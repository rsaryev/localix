import type { Pause } from './budget'
import type { DispatchOptions } from './engine'
import { OP_SHAPES } from './op-events'

/**
 * The calls a mod makes on `$`, as Claude Code's engine answers them: each is an event other mods
 * may hook (`fs.read`), fired past the hooks of the mod that made it, and answers with a promise
 * that a throw or a hook's deny rejects — except the few calls Claude Code keeps synchronous.
 */

/** A mods API: namespaces of methods (`$.fs.read`) and values (`$.plugin.name`). */
export type ModsApi = Record<string, Record<string, unknown>>

/** The `$` calls Claude Code answers at once rather than with a promise; each still fires. */
export const SYNC_CALLS: ReadonlySet<string> = new Set([
  'ui.notice',
  'ui.invalidate',
  'ui.resolve',
  'ui.log',
  'ui.toast',
  'ui.status',
  'clock.after',
  'clock.every',
])

interface Dispatcher {
  hears(event: string, plugins?: ReadonlySet<string>): boolean
  dispatch(
    event: string,
    input: unknown,
    core: (event: unknown) => unknown,
    opts?: DispatchOptions,
  ): Promise<unknown>
}

/** What a call answers once its event's chain settled: `{ value }`, or the deny it rejects with. */
function valueOf(answer: unknown): unknown {
  if (answer && typeof answer === 'object') {
    const { deny, value } = answer as { deny?: unknown; value?: unknown }
    if (typeof deny === 'string') throw new Error(deny)
    if ('value' in answer) return value
  }
  return answer
}

/**
 * `peers` names the mods whose hooks a call reaches — the mods running where the calling one does
 * — so a call in one project never runs another project's hooks; absent, every mod's.
 *
 * A call Claude Code serves as an op event (`op-events.ts`) reaches its hooks as its documented
 * input (`$.fs.read('a.md')` is `{ path, as }`); `next(e)` resolves to `{ value }`, a hook may
 * answer `{ value }` or `{ deny }`, and a deny rejects the caller's promise with its reason. A
 * synchronous call (`$.ui.toast`, `$.clock.after`) fires its event without waiting on it. Any
 * other call (`$.tool.call`, `$.prompt.submit`) is that event itself, answered as it answers.
 */
export function interceptApi(
  engine: Dispatcher,
  plugin: string,
  api: ModsApi,
  peers?: () => ReadonlySet<string> | undefined,
): ModsApi {
  const intercepted: ModsApi = {}
  for (const [namespace, members] of Object.entries(api)) {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(members)) {
      const event = `${namespace}.${name}`
      if (typeof member !== 'function' || event === 'ui.resolve') {
        wrapped[name] = member
        continue
      }
      const method = member as (...args: unknown[]) => unknown
      const sync = SYNC_CALLS.has(event)
      const shape = OP_SHAPES.get(event)
      wrapped[name] = (...args: unknown[]) => {
        const plugins = peers?.()
        if (!engine.hears(event, plugins))
          return sync ? method(...args) : Promise.resolve().then(() => method(...args))
        const opts = {
          origin: { plugin, tier: 'user' as const },
          skipPlugin: plugin,
          ...(plugins ? { plugins } : {}),
        }
        if (!shape)
          return engine.dispatch(event, args[0] ?? {}, (e) => method(e, ...args.slice(1)), opts)
        const core = async (e: unknown) => ({
          value: await method(...shape.args(e as Record<string, unknown>, args)),
        })
        const answered = engine.dispatch(event, shape.input(args), core, opts).then(valueOf)
        if (!sync) return answered
        answered.catch(() => {})
        // A timer's handle cancels once its event let it start; the other calls answer nothing.
        if (namespace !== 'clock') return undefined
        const cancel = (timer: unknown) =>
          (timer as { cancel?: () => void } | undefined)?.cancel?.()
        return { cancel: () => void answered.then(cancel, () => {}) }
      }
    }
    intercepted[namespace] = wrapped
  }
  return intercepted
}

/** `$` calls whose wait is the hook's own time (Claude Code counts a sleep against the budget). */
export const COUNTED_CALLS: ReadonlySet<string> = new Set(['clock.sleep'])

/**
 * `$` as one hook run receives it: the clock of that run stops while any of its asynchronous calls
 * is in flight (`$.ui.ask`, `$.model.complete`, `$.process.run`), as Claude Code's does, so a
 * guard waiting on a person or a model is not skipped for running out of time.
 */
export function pausedApi(api: ModsApi, pause: Pause): ModsApi {
  const paused: ModsApi = {}
  for (const [namespace, members] of Object.entries(api)) {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(members)) {
      const event = `${namespace}.${name}`
      if (typeof member !== 'function' || SYNC_CALLS.has(event) || COUNTED_CALLS.has(event)) {
        wrapped[name] = member
        continue
      }
      const method = member as (...args: unknown[]) => unknown
      wrapped[name] = (...args: unknown[]) => {
        const answer = method.apply(members, args)
        return isThenable(answer) ? pause(answer) : answer
      }
    }
    paused[namespace] = wrapped
  }
  return paused
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function'

/** A deep, frozen copy of plain data; anything else (a function, a class instance) as it is. */
export function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value)) copy[key] = freezeDeep(field)
    return Object.freeze(copy) as T
  }
  return value
}
