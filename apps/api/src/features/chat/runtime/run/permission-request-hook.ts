/**
 * Claude Code's PermissionRequest on an approval card: the hooks run beside the card, and
 * whichever decides first applies — a hook that answers withdraws the card; a person who answers
 * first leaves the hook's later verdict unread. A hook with no decision leaves the card to the
 * person, so a slow hook (one that waits to deny a card left unanswered) races the person fairly.
 */
import type { CcHookToolRef, CcHooksRuntime, PermissionRequestResult } from '../../../cc-hooks'
import type { ConfirmOutcome } from '../../../agent-core/permission-engine'

export type CardRace<T> =
  | { kind: 'card'; value: T }
  | {
      kind: 'hook'
      decision: Required<Pick<PermissionRequestResult, 'behavior'>> & PermissionRequestResult
    }

/**
 * Show the card (`ask`) and run the hooks together. `ask` receives a signal that also fires when
 * a hook decides, so the card is withdrawn the way an abandoned call withdraws it.
 */
export async function raceCardWithPermissionHooks<T>(
  ccHooks: CcHooksRuntime,
  /** `tool`, when known, carries the MCP aliases and server a hook matcher and input read. */
  call: { toolName: string; tool?: CcHookToolRef; input: unknown },
  signal: AbortSignal,
  ask: (signal: AbortSignal) => Promise<T>,
): Promise<CardRace<T>> {
  if (!ccHooks.hasHooks('PermissionRequest')) return { kind: 'card', value: await ask(signal) }
  const hookDecided = new AbortController()
  let decided: CardRace<T> | undefined
  void ccHooks
    .runPermissionRequest(call.tool ?? call.toolName, call.input)
    .then((decision) => {
      if (!decision.behavior || decided || signal.aborted) return
      decided = { kind: 'hook', decision: { ...decision, behavior: decision.behavior } }
      hookDecided.abort()
    })
    .catch(() => {})
  try {
    const value = await ask(AbortSignal.any([signal, hookDecided.signal]))
    if (decided) return decided
    // The person answered first: whatever the hooks say later is not read.
    decided = { kind: 'card', value }
    return decided
  } catch (error) {
    if (decided?.kind === 'hook') return decided
    throw error
  }
}

/**
 * The gate's reading of a hook's decision. An `allow` with `updatedInput` hands the rewrite to
 * the call (applied and re-validated where it runs); `deny` with `interrupt` also stops the run.
 */
export function hookConfirmOutcome(
  ccHooks: CcHooksRuntime,
  toolCallId: string,
  decision: PermissionRequestResult,
  stopRun?: () => void,
): ConfirmOutcome {
  if (decision.behavior === 'allow') {
    if (decision.updatedInput !== undefined)
      ccHooks.approveWithInput(toolCallId, decision.updatedInput)
    return { approved: true, via: 'hook' }
  }
  if (decision.interrupt) stopRun?.()
  return {
    approved: false,
    via: 'hook',
    ...(decision.message ? { message: decision.message } : {}),
  }
}
