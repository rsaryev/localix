import type { ActionContext } from './context'
import { evaluateActionWhen } from './context'

export interface ActionHandler {
  commandId: string
  run: () => void
  enabled?: () => boolean
  /** Additional surface-specific context condition, combined with the catalog condition. */
  when?: string
}

const handlers = new Map<string, ActionHandler[]>()

/** Register one command implementation. Newer/scoped handlers take precedence. */
export function registerActionHandler(handler: ActionHandler): () => void {
  const entries = handlers.get(handler.commandId) ?? []
  entries.push(handler)
  handlers.set(handler.commandId, entries)
  return () => {
    const live = handlers.get(handler.commandId)
    if (!live) return
    const index = live.indexOf(handler)
    if (index >= 0) live.splice(index, 1)
    if (live.length === 0) handlers.delete(handler.commandId)
  }
}

/** Execute the highest-precedence enabled handler. False means nobody claimed it. */
export function executeAction(
  commandId: string,
  context: ActionContext,
  definitionWhen?: string,
): boolean {
  if (!evaluateActionWhen(definitionWhen, context)) return false
  const entries = handlers.get(commandId)
  if (!entries) return false
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const handler = entries[index]
    if (!handler || handler.enabled?.() === false) continue
    if (!evaluateActionWhen(handler.when, context)) continue
    handler.run()
    return true
  }
  return false
}

/** Test-only reset; production lifetimes are owned by registration cleanups. */
export function clearActionHandlers(): void {
  handlers.clear()
}
