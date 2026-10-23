import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { z } from 'zod'
import { MiniAppApiError, miniAppApiFetch, unwrapMiniAppResponse } from './transport'
import { useVisiblePolling } from './visibility'

export interface PolledSnapshot<T> {
  /** Last successfully validated response; kept when a later poll fails. */
  snapshot: T | null
  /** Set while the latest poll or action failed; cleared by the next success. */
  error: string | null
  /** True only until the first poll settles, so a refresh never flashes a spinner. */
  loading: boolean
  /** True while an action sent with `send` waits for its answer: disable what would send again. */
  sending: boolean
  /**
   * Send one action and show its result at once. POSTs `body` as JSON to `path` (the polled route
   * when omitted); the route answers with the NEW snapshot, which the same schema validates and
   * which replaces the polled one immediately. Resolves to it, or to null when the action failed —
   * `error` then carries the route's own message.
   *
   * `send` and `refresh` are typed as function PROPERTIES, not methods: both are closures with no
   * `this`, and the method form made every `const { send } = polled` an unbound-method error.
   */
  send: (body: unknown, options?: SendOptions) => Promise<T | null>
  /** Poll now — after something changed the state without answering with it. */
  refresh: () => void
}

export interface SendOptions {
  path?: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
}

/**
 * Poll one mini app route while the surface is visible, and send the actions that change it.
 *
 * Polling is the SDK's `useVisiblePolling` (host work-item visibility, document visibility, no
 * overlapping ticks); this hook adds what a snapshot needs: a bounded request, schema validation,
 * last-good-sample semantics — and one way to act on it.
 *
 * Why actions live HERE: a copy that sent its own POST and kept the answer in a second piece of
 * state had to guess which of two snapshots to show, and guessed wrong. A timer froze
 * after the first click — it kept the click's answer until both fields differed from the poll's,
 * so the countdown never moved — and four rewrites later still raced a poll that had left before
 * the click and landed after it. There is one snapshot. Every request takes a ticket; an answer
 * is shown only if nothing newer has been shown, and a poll that returns while an action is in
 * flight is dropped, because the action's answer is newer than anything that poll read. The shape
 * is SWR's: a revalidation that overlaps a mutation is discarded (`use-swr.ts`).
 */
export function usePolledSnapshot<T>({
  path,
  schema,
  intervalMs,
  active = true,
  timeoutMs = 8000,
  failureMessage,
}: {
  path: string
  schema: z.ZodType<T>
  intervalMs: number | null
  active?: boolean
  timeoutMs?: number
  failureMessage: string
}): PolledSnapshot<T> {
  const [state, setState] = useState<Pick<PolledSnapshot<T>, 'snapshot' | 'error' | 'loading'>>({
    snapshot: null,
    error: null,
    loading: true,
  })
  const scope = useRef({ path, epoch: 0, active: true })
  if (scope.current.path !== path)
    scope.current = { path, epoch: scope.current.epoch + 1, active: true }
  useEffect(() => {
    scope.current.active = true
    return () => {
      scope.current.active = false
      scope.current.epoch++
    }
  }, [path])
  // The last snapshot shown, as JSON. A read that brings back the same data keeps the object it
  // already rendered: every poll and every store nudge used to hand the view a new object, so a board
  // re-rendered whole and republished its message context while nothing on it had changed.
  const shownJson = useRef<string | null>(null)
  const [pending, setPending] = useState(0)
  const tickets = useMemo(() => ({ path, issued: 0, shown: 0, sending: 0 }), [path])
  useEffect(() => {
    setPending(0)
    shownJson.current = null
    setState({ snapshot: null, error: null, loading: true })
  }, [path])

  const show = useCallback(
    (ticket: number, snapshot: T) => {
      if (ticket < tickets.shown) return
      tickets.shown = ticket
      const json = JSON.stringify(snapshot)
      const same = json === shownJson.current
      shownJson.current = json
      setState((current) =>
        same && current.snapshot !== null && current.error === null && !current.loading
          ? current
          : {
              snapshot: same && current.snapshot !== null ? current.snapshot : snapshot,
              error: null,
              loading: false,
            },
      )
    },
    [tickets],
  )

  const onTick = useCallback(async () => {
    const epoch = scope.current.epoch
    const current = () =>
      scope.current.active && scope.current.path === path && scope.current.epoch === epoch
    const ticket = ++tickets.issued
    try {
      const response = await miniAppApiFetch(path, { signal: AbortSignal.timeout(timeoutMs) })
      const snapshot = schema.parse(await unwrapMiniAppResponse<unknown>(response))
      if (current() && tickets.sending === 0) show(ticket, snapshot)
    } catch {
      if (!current() || tickets.sending > 0 || ticket < tickets.shown) return
      setState((current) => ({ ...current, error: failureMessage, loading: false }))
    }
  }, [path, schema, timeoutMs, failureMessage, show, tickets])

  const send = useCallback(
    async (body: unknown, options: SendOptions = {}): Promise<T | null> => {
      const epoch = scope.current.epoch
      const current = () =>
        scope.current.active && scope.current.path === path && scope.current.epoch === epoch
      const ticket = ++tickets.issued
      tickets.sending += 1
      setPending((count) => count + 1)
      try {
        const response = await miniAppApiFetch(options.path ?? path, {
          method: options.method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const snapshot = schema.parse(await unwrapMiniAppResponse<unknown>(response))
        if (current()) show(ticket, snapshot)
        return snapshot
      } catch (error) {
        // The route's own sentence ("That note is too long.") when it answered one; a transport
        // or schema failure is the fixed message, never a stack or a zod dump.
        if (!current() || ticket < tickets.shown) return null
        const message = error instanceof MiniAppApiError ? error.message : failureMessage
        setState((current) => ({ ...current, error: message, loading: false }))
        return null
      } finally {
        tickets.sending -= 1
        if (current()) setPending((count) => count - 1)
      }
    },
    [path, schema, timeoutMs, failureMessage, show, tickets],
  )

  useVisiblePolling({ enabled: active, intervalMs, immediate: true, onTick, resetKey: path })
  const refresh = useCallback(() => void onTick(), [onTick])
  return { ...state, sending: pending > 0, send, refresh }
}
