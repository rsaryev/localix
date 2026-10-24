/**
 * "When an event fires, its matching hooks run in parallel. If more than 12 of them are prompt or
 * agent hooks, 12 of those run at once and the rest start as running ones finish" (hooks.md, "Hook
 * handler fields"). Every handler sees the same input; the caller folds the outcomes in
 * declaration order, so which hook decides stays the same from run to run.
 */
import type { CcHookHandler } from './contracts'

/** Prompt and agent hooks that may run at once; command, http and mcp_tool hooks are not capped. */
export const MAX_MODEL_HOOKS_AT_ONCE = 12

const isModelHook = (handler: CcHookHandler) =>
  handler.kind === 'prompt' || handler.kind === 'agent'

/** Run every handler at once (model hooks twelve at a time); results in the handlers' order. */
export async function runInParallel<T>(
  handlers: readonly CcHookHandler[],
  run: (handler: CcHookHandler) => Promise<T>,
): Promise<T[]> {
  const results: T[] = Array.from({ length: handlers.length })
  const queued = handlers.flatMap((handler, i) => (isModelHook(handler) ? [i] : []))
  const modelSlot = async () => {
    for (let i = queued.shift(); i !== undefined; i = queued.shift())
      results[i] = await run(handlers[i]!)
  }
  await Promise.all([
    ...handlers.flatMap((handler, i) =>
      isModelHook(handler) ? [] : [run(handler).then((result) => (results[i] = result))],
    ),
    ...Array.from({ length: Math.min(MAX_MODEL_HOOKS_AT_ONCE, queued.length) }, modelSlot),
  ])
  return results
}
