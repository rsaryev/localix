import { isToolEvent, type CcHookEvent, type CcHookHandler, type CcHookRegistry } from './contracts'
import type { HookLogger } from './executor'
import { evaluateIfGuard } from './if-guard'
import { plural } from '../../lib/plural'

export interface SelectOptions {
  /** Tool-event context for `if` guards. */
  ifCtx?: { toolName: string; toolInput: unknown }
  /** Extra restriction applied BEFORE the guards (SubagentStop's `sourcesOnly`). */
  filter?: (h: CcHookHandler) => boolean
}

interface HookSelectionOptions {
  registry: CcHookRegistry
  sessionId: string
  logger: HookLogger
  onceKeys?: Set<string>
  signalFor: (event: CcHookEvent) => AbortSignal | undefined
}

/** Select handlers against the live registry, retaining guard and once ordering. */
export function createHookSelector(options: HookSelectionOptions) {
  const { registry, sessionId, logger, onceKeys, signalFor } = options
  /** `once` per-session key for a handler (stable across the per-run runtimes). */
  const onceKey = (event: CcHookEvent, h: CcHookHandler): string =>
    `${event}::${h.source}::${h.pluginName ?? ''}::${h.command || h.prompt || ''}`

  /**
   * The handlers that will actually RUN for one event — or `null` when the event is
   * INERT (no group matched, every `if` guard failed, or the only `once` handlers
   * already ran this session). Every dispatch point short-circuits on that single
   * fact instead of re-deriving "did anything match?" for itself.
   *
   * Selection, in order — the order is the contract:
   *   - group matcher accepts the event's match value (`matchFn`);
   *   - caller `filter`;
   *   - `if` guard: on tool events keep a handler only if its guard passes; on
   *     non-tool events a handler carrying an `if` never runs (CC §3);
   *   - `once`: skip handlers whose key already ran this session; MARK the rest as
   *     run — a selected `once` handler is spent whether or not it later blocks;
   *   - partition into `sync` (block-capable) and `async` (fire-and-forget).
   */
  function select(
    event: CcHookEvent,
    matchFn: (matcher: string | undefined) => boolean,
    opts: SelectOptions = {},
  ): { sync: CcHookHandler[]; async: CcHookHandler[] } | null {
    if (signalFor(event)?.aborted) return null
    const sync: CcHookHandler[] = []
    const asyncH: CcHookHandler[] = []
    for (const group of registry[event] ?? []) {
      if (!matchFn(group.matcher)) continue
      for (const h of group.handlers) {
        if (opts.filter && !opts.filter(h)) continue
        if (h.if) {
          if (!isToolEvent(event) || !opts.ifCtx) continue // `if` only applies on tool events
          if (!evaluateIfGuard(h.if, opts.ifCtx.toolName, opts.ifCtx.toolInput)) continue
        }
        if (h.once && onceKeys) {
          const key = onceKey(event, h)
          if (onceKeys.has(key)) continue
          onceKeys.add(key)
        }
        ;(h.async ? asyncH : sync).push(h)
      }
    }
    const count = sync.length + asyncH.length
    if (count === 0) return null
    logger.info?.(`[cc-hooks] session ${sessionId}: ${event} fired ${plural(count, 'hook')}`)
    return { sync, async: asyncH }
  }

  return select
}
