import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { recordCoreChanges } from '../changes/core-entities'
import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import type { SystemToggleState } from './contracts'
import type { SystemToggleDef } from './toggle'
import { createKeepAwakeToggle } from './toggles/keep-awake'

export interface SystemServiceDeps {
  /** Where a switched control is announced (`system.toggle`); its state itself lives here. */
  db?: Kysely<AppDatabase>
  logger?: { warn: (msg: string, meta?: unknown) => void }
  /**
   * Explicit toggle definitions to register. When omitted the service registers
   * the built-in `keep-awake` toggle. Pass a custom list in tests or when
   * extending the set of controls without touching this file.
   */
  toggles?: SystemToggleDef[]
}

export interface SystemService {
  /** All registered controls + their current state. */
  listToggles(): SystemToggleState[]
  /** Flip one control on/off; returns its new state. */
  setToggle(id: string, enabled: boolean): Promise<SystemToggleState>
  /** Release every active control (server shutdown). */
  stopAll(): Promise<void>
}

/**
 * Host-level system controls. A generic registry of on/off toggles (keep-awake
 * today; add more by registering a `SystemToggleDef`). State is in-memory and
 * process-wide — these affect the machine the server runs on, not a user row.
 */
export function createSystemService(deps: SystemServiceDeps = {}): SystemService {
  const defs = new Map<string, SystemToggleDef>()
  const enabled = new Map<string, boolean>()

  const register = (def: SystemToggleDef) => {
    defs.set(def.id, def)
    enabled.set(def.id, false)
  }

  const builtins = deps.toggles ?? [createKeepAwakeToggle(deps.logger)]
  for (const def of builtins) register(def)

  const toState = (def: SystemToggleDef): SystemToggleState => ({
    id: def.id,
    title: def.title,
    description: def.description,
    available: def.isAvailable(),
    enabled: enabled.get(def.id) ?? false,
  })

  return {
    listToggles: () => [...defs.values()].map(toState),

    async setToggle(id, next) {
      const def = defs.get(id)
      if (!def) throw new NotFoundError('toggle_not_found', `Unknown system control "${id}"`)
      if (next && !def.isAvailable()) {
        throw new ConflictError(
          'toggle_unavailable',
          `"${def.title}" is not supported on this system.`,
        )
      }
      if ((enabled.get(id) ?? false) !== next) {
        if (next) await def.enable()
        else await def.disable()
        enabled.set(id, next)
        if (deps.db)
          await recordCoreChanges(deps.db, { entity: 'system.toggle', op: 'upserted', ref: { id } })
      }
      return toState(def)
    },

    async stopAll() {
      for (const [id, def] of defs) {
        if (enabled.get(id)) {
          try {
            await def.disable()
          } catch {
            /* best-effort on shutdown */
          }
          enabled.set(id, false)
        }
      }
    },
  }
}
