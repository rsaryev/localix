import type { Capabilities, CapabilityKey, CapabilityShapes } from '@localixai/mini-app-sdk/backend'

/**
 * Registry of mini-app-contributed SDK capabilities.
 * FIRST-WINS: at most one provider per key — like the memory-provider rule, the
 * first enabled mini app to declare a capability owns it and a later declaration is
 * a loud diagnostic (mini app contributions are untrusted data; a collision must
 * degrade to a warning the author sees, never crash boot for everyone else).
 */
export interface CapabilityRegistry {
  /** Register every capability a subsystem declares. Collisions are warned + skipped. */
  register(sourceId: string, capabilities: Capabilities | undefined): void
  /**
   * Drop everything a subsystem contributed — hot mini app DISABLE.
   *
   * Without this a disabled mini app's capability stayed registered and core kept calling into it:
   * the user turned the mini app off and its code still ran. Unknown ids are a no-op, and only the
   * entries this source actually owns are removed (a first-wins loser must not be able to evict the
   * winner).
   */
  unregister(sourceId: string): void
  /** The registered implementation for a key, or undefined (feature degrades). */
  get<K extends CapabilityKey>(key: K): CapabilityShapes[K] | undefined
}

export function createCapabilityRegistry(
  warn: (msg: string) => void = () => {},
): CapabilityRegistry {
  const entries = new Map<CapabilityKey, { value: unknown; sourceId: string }>()
  return {
    register(sourceId, capabilities) {
      for (const [key, value] of Object.entries(capabilities ?? {})) {
        if (value === undefined) continue
        const k = key as CapabilityKey
        const existing = entries.get(k)
        if (existing) {
          warn(
            `capability '${k}' from '${sourceId}' ignored — already provided by '${existing.sourceId}'`,
          )
          continue
        }
        entries.set(k, { value, sourceId })
      }
    },
    unregister(sourceId) {
      for (const [key, entry] of entries) {
        if (entry.sourceId === sourceId) entries.delete(key)
      }
    },
    get(key) {
      return entries.get(key)?.value as CapabilityShapes[typeof key] | undefined
    },
  }
}
