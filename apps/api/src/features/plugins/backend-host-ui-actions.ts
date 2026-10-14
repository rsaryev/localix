/**
 * PLUGIN UI ACTIONS — which wired handler answers a call from a plugin's sandboxed UI, and how
 * long it may take.
 *
 * It follows the OPPOSITE scoping rule to everything else the backend host wires, which is why it
 * is its own table. Providers and routes are process-global, so `backend-host.ts` keeps ONE
 * discovered scope per plugin name; keying UI actions the same way would make a project-local
 * override answer with the global copy's handler. This table is keyed by the exact
 * (plugin, project) scope instead, so both coexist and a call reaches the one its context names.
 *
 * Resolution refuses rather than guesses: an action that is not an OWN property of `uiActions` is
 * not available (`constructor` must not resolve through the prototype), two handlers for one
 * action in one scope are ambiguous rather than first-wins, and a handler that never settles is
 * cut off by a timeout instead of holding the UI's request open.
 */
import type { PluginUiActionContext } from '@localixai/plugin-sdk/backend'
import type { BackendSubsystem } from '../ext/subsystem-contrib'

export class PluginUiActionError extends Error {
  constructor(
    readonly code: 'not_available' | 'ambiguous' | 'timeout',
    message: string,
  ) {
    super(message)
    this.name = 'PluginUiActionError'
  }
}

/** One operation invoked by an enabled plugin's sandboxed UI. */
export interface PluginUiActionCall {
  pluginName: string
  action: string
  payload: unknown
  context: PluginUiActionContext
  timeoutMs?: number
}

export interface PluginUiActionTable {
  /** Record `backend` under its exact (plugin, project) scope. */
  add(pluginName: string, projectId: string, backend: BackendSubsystem): void
  invoke(call: PluginUiActionCall): Promise<unknown>
}

const UI_ACTION_TIMEOUT_MS = 15_000

/**
 * A fresh, empty table. The host builds the next one during a reconcile and swaps it in only
 * after the whole pass succeeds, so a failed refresh keeps the last known-good actions.
 */
export function createPluginUiActionTable(): PluginUiActionTable {
  const scopes = new Map<string, BackendSubsystem[]>()
  const scopeKey = (pluginName: string, projectId: string) => `${pluginName}\x00${projectId}`

  return {
    add(pluginName, projectId, backend) {
      const key = scopeKey(pluginName, projectId)
      const scopedBackends = scopes.get(key) ?? []
      scopedBackends.push(backend)
      scopes.set(key, scopedBackends)
    },
    async invoke(call) {
      const handlers = (
        scopes.get(scopeKey(call.pluginName, call.context.projectId)) ?? []
      ).flatMap((backend) => {
        const handler =
          backend.uiActions && Object.prototype.hasOwnProperty.call(backend.uiActions, call.action)
            ? backend.uiActions?.[call.action]
            : undefined
        return handler ? [handler] : []
      })
      if (handlers.length === 0) {
        throw new PluginUiActionError(
          'not_available',
          `Plugin "${call.pluginName}" exposes no UI action "${call.action}"`,
        )
      }
      if (handlers.length > 1) {
        throw new PluginUiActionError(
          'ambiguous',
          `Plugin "${call.pluginName}" exposes UI action "${call.action}" more than once`,
        )
      }

      const timeoutMs = call.timeoutMs ?? UI_ACTION_TIMEOUT_MS
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          Promise.resolve().then(() => handlers[0]!(call.payload, call.context)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new PluginUiActionError(
                    'timeout',
                    `Plugin UI action timed out after ${timeoutMs}ms`,
                  ),
                ),
              timeoutMs,
            )
          }),
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  }
}
