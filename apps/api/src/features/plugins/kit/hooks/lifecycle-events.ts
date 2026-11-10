import type { HookOutcome } from '@rsaryev/llx-plugin'
import type { CcHooksRuntime } from '../../../cc-hooks/runtime-contracts'
import type { CcModelSwitch, CcTask } from '../../../cc-hooks/runtime-contracts-added'
import { claudeText, type EventDeps, type HookEvent } from './runtime'

type LifecycleEvents = Pick<
  CcHooksRuntime,
  | 'runStopFailure'
  | 'runPostCompact'
  | 'runInstructionsLoaded'
  | 'runConfigChange'
  | 'runCwdChanged'
  | 'runFileChanged'
  | 'runPreModelSwitch'
  | 'runPostModelSwitch'
  | 'runTaskCreated'
  | 'runTaskCompleted'
>

const watched = (outcome: HookOutcome<HookEvent> | undefined) =>
  outcome?.effects.watchPaths ? { watchPaths: [...outcome.effects.watchPaths] } : {}

const refused = (outcome: HookOutcome<HookEvent> | undefined) =>
  outcome !== undefined && (!outcome.proceed || !outcome.continue)

const switchFacts = (change: CcModelSwitch) => ({
  from_model: change.fromModel,
  to_model: change.toModel,
  requested_model: change.requestedModel,
  source: change.source,
})

/** The events between and around turns: a model switch, a moved folder, a watched file, a task. */
export function createLifecycleEvents({ fire }: EventDeps): LifecycleEvents {
  const task = async (event: 'TaskCreated' | 'TaskCompleted', given: CcTask) => {
    const outcome = await fire(event, {
      task_id: given.id,
      task_subject: given.subject,
      ...(given.description ? { task_description: given.description } : {}),
    } as never)
    if (!refused(outcome)) return { blocked: false }
    const reason = outcome?.block?.reason || outcome?.stopReason?.trim()
    return { blocked: true, ...(reason ? { reason } : {}) }
  }
  return {
    async runStopFailure(failure) {
      await fire('StopFailure', {
        error: failure.error as never,
        ...(failure.details ? { error_details: failure.details } : {}),
        ...(failure.message ? { last_assistant_message: failure.message } : {}),
      })
    },
    async runPostCompact(trigger, summary) {
      await fire('PostCompact', { trigger, compact_summary: summary })
    },
    async runInstructionsLoaded(file) {
      await fire('InstructionsLoaded', {
        file_path: file.path,
        memory_type: file.memoryType,
        load_reason: file.loadReason,
      } as never)
    },
    async runConfigChange(source, filePath) {
      // The kit holds `policy_settings` unblockable.
      const outcome = await fire('ConfigChange', {
        source: source as never,
        ...(filePath ? { file_path: filePath } : {}),
      })
      return { blocked: refused(outcome) }
    },
    runCwdChanged: async (oldCwd, newCwd) =>
      watched(await fire('CwdChanged', { old_cwd: oldCwd, new_cwd: newCwd })),
    runFileChanged: async (filePath, event) =>
      watched(await fire('FileChanged', { file_path: filePath, event })),
    async runPreModelSwitch(change) {
      const outcome = await fire('PreModelSwitch', switchFacts(change) as never)
      if (!outcome) return { decision: 'proceed' }
      const { permissionDecision, permissionDecisionReason } = outcome.effects
      if (!outcome.proceed || permissionDecision === 'deny')
        return {
          decision: 'deny',
          reason: permissionDecisionReason || outcome.block?.reason || undefined,
        }
      if (permissionDecision === 'ask' || permissionDecision === 'allow')
        return {
          decision: permissionDecision,
          ...(permissionDecisionReason ? { reason: permissionDecisionReason } : {}),
        }
      return { decision: 'proceed' }
    },
    async runPostModelSwitch(change) {
      const additionalContext = claudeText(
        await fire('PostModelSwitch', switchFacts(change) as never),
      )
      return additionalContext ? { additionalContext } : {}
    },
    runTaskCreated: (given) => task('TaskCreated', given),
    runTaskCompleted: (given) => task('TaskCompleted', given),
  }
}
