/**
 * Claude Code hook events a person's own edits raise between turns: the model switch (`/model`,
 * the model picker) and a project move that changes the working directory. They fire the hooks
 * the session's latest run assembled (`runtime/cc-hook-sessions.ts`).
 *
 *   - PreModelSwitch runs before the switch is written; a deny (exit 2, `decision:"block"`,
 *     `permissionDecision:"deny"`, a timeout) refuses the request. `ask` has no prompt on these
 *     surfaces, so it refuses too — as CC treats it everywhere but its interactive `/model`.
 *   - PostModelSwitch runs after; its context reaches the model with the next request.
 *   - CwdChanged runs after the move; its `watchPaths` replace the FileChanged watch list.
 */
import { ConflictError } from '../../../lib/domain-errors'
import type { CcModelSwitch } from '../../cc-hooks'
import type { CcHookSessions } from '../runtime/cc-hook-sessions'

/** One agent whose model a request changes. */
export interface ModelSwitchChange {
  fromModel: string
  toModel: string
  /** What the request named, when it named something other than the resolved id. */
  requestedModel?: string
}

/** The model change a route request makes, against the session's route as it is now. */
export function modelSwitches(
  current: { modelId: string } | null,
  route: { modelId?: string } | undefined,
): ModelSwitchChange[] {
  const before = current?.modelId ?? ''
  return route?.modelId && route.modelId !== before
    ? [{ fromModel: before, toModel: route.modelId }]
    : []
}

const asSwitch = (change: ModelSwitchChange, source: CcModelSwitch['source']): CcModelSwitch => ({
  fromModel: change.fromModel,
  toModel: change.toModel,
  requestedModel: change.requestedModel ?? change.toModel,
  source,
})

/** PreModelSwitch for each change: the first refusal's reason, or undefined to go ahead. */
export async function modelSwitchRefusal(
  hooks: CcHookSessions | undefined,
  sessionId: string,
  changes: readonly ModelSwitchChange[],
  source: CcModelSwitch['source'],
): Promise<string | undefined> {
  if (!hooks || changes.length === 0) return undefined
  const runtime = hooks.runtimeFor(sessionId)
  if (!runtime.hasHooks('PreModelSwitch')) return undefined
  for (const change of changes) {
    const verdict = await runtime.runPreModelSwitch(asSwitch(change, source))
    if (verdict.decision === 'deny' || verdict.decision === 'ask')
      return verdict.reason || `A PreModelSwitch hook blocked the switch to ${change.toModel}.`
  }
  return undefined
}

/** {@link modelSwitchRefusal} for a request that answers a refusal with an error. */
export async function guardModelSwitches(
  hooks: CcHookSessions | undefined,
  sessionId: string,
  changes: readonly ModelSwitchChange[],
  source: CcModelSwitch['source'],
): Promise<void> {
  const refusal = await modelSwitchRefusal(hooks, sessionId, changes, source)
  if (refusal) throw new ConflictError('model_switch_blocked', refusal)
}

/** PostModelSwitch for each change, after the write; its context waits for the next request. */
export function announceModelSwitches(
  hooks: CcHookSessions | undefined,
  sessionId: string,
  changes: readonly ModelSwitchChange[],
  source: CcModelSwitch['source'],
): void {
  if (!hooks || changes.length === 0) return
  const runtime = hooks.runtimeFor(sessionId)
  if (!runtime.hasHooks('PostModelSwitch')) return
  // Several switches before the next request deliver only the last one's output, as in CC.
  void (async () => {
    let context: string | undefined
    for (const change of changes)
      context = (await runtime.runPostModelSwitch(asSwitch(change, source))).additionalContext
    hooks.setPendingContext(sessionId, context)
  })().catch(() => {})
}

/** CwdChanged after the session's working directory moved. */
export function announceCwdChange(
  hooks: CcHookSessions | undefined,
  sessionId: string,
  oldCwd: string,
  newCwd: string,
): void {
  if (!hooks || oldCwd === newCwd) return
  const runtime = hooks.runtimeFor(sessionId)
  if (!runtime.hasHooks('CwdChanged')) return
  void runtime
    .runCwdChanged(oldCwd, newCwd)
    .then(({ watchPaths }) => {
      if (watchPaths) hooks.setWatchPaths(sessionId, watchPaths)
    })
    .catch(() => {})
}
