import type { DispatchOptions } from './engine'

/**
 * The calls a mod makes on `$`, as Claude Code's engine answers them: each is an event other mods
 * may hook (`fs.read`), fired past the hooks of the mod that made it, and answers with a promise
 * that a throw rejects — except the few calls Claude Code keeps synchronous.
 */

/** A mods API: namespaces of methods (`$.fs.read`) and values (`$.plugin.name`). */
export type ModsApi = Record<string, Record<string, unknown>>

/** The `$` calls Claude Code answers at once rather than with a promise; none is an event. */
const SYNC_CALLS: ReadonlySet<string> = new Set([
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

/**
 * `peers` names the mods whose hooks a call reaches — the mods running where the calling one does
 * — so a call in one project never runs another project's hooks; absent, every mod's.
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
      if (typeof member !== 'function') {
        wrapped[name] = member
        continue
      }
      const event = `${namespace}.${name}`
      const method = member as (...args: unknown[]) => unknown
      if (SYNC_CALLS.has(event)) {
        wrapped[name] = method
        continue
      }
      wrapped[name] = (first?: unknown, ...rest: unknown[]) => {
        const plugins = peers?.()
        return engine.hears(event, plugins)
          ? engine.dispatch(event, first ?? {}, (e) => method(e, ...rest), {
              origin: { plugin, tier: 'user' },
              skipPlugin: plugin,
              ...(plugins ? { plugins } : {}),
            })
          : Promise.resolve().then(() => method(first, ...rest))
      }
    }
    intercepted[namespace] = wrapped
  }
  return intercepted
}

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
