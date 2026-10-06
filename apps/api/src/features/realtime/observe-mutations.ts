import type { RealtimeResource } from './resources'

type UserMutationKeys<T> = {
  [K in keyof T]: T[K] extends (userId: string, ...args: never[]) => Promise<unknown> ? K : never
}[keyof T]

type MutationResources<T> = {
  [K in UserMutationKeys<T>]?:
    | readonly RealtimeResource[]
    | (T[K] extends (...args: infer A) => unknown
        ? (...args: A) => readonly RealtimeResource[]
        : never)
}

/**
 * Compose commit notifications onto service methods, so HTTP, plugins and internal callers use
 * the same contract. Explicit method maps keep reads silent. The service retains its type and
 * identity; no proxy, second transport or domain dependency on realtime is needed.
 */
export function observeMutations<T extends object>(
  service: T,
  mutations: MutationResources<T>,
  publish: (userId: string, resources: readonly RealtimeResource[]) => void,
): void {
  for (const [name, resources] of Object.entries(mutations)) {
    const methods = service as Record<
      string,
      (userId: string, ...args: unknown[]) => Promise<unknown>
    >
    const original = methods[name]!
    methods[name] = async function (userId, ...args) {
      const result = await original.call(service, userId, ...args)
      try {
        const affected =
          typeof resources === 'function'
            ? (resources(userId, ...args) as readonly RealtimeResource[])
            : (resources as readonly RealtimeResource[])
        if (affected.length) publish(userId, affected)
      } catch (error) {
        // A committed mutation must never look failed because an observer failed.
        console.warn('[realtime] committed change notification failed', error)
      }
      return result
    }
  }
}
