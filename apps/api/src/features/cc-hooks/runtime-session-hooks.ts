/**
 * The added events about the session around the turn: a failed turn, a checkpoint, the
 * instruction files, configuration, the working directory, watched files and the model.
 * Most are observers; ConfigChange and PreModelSwitch can refuse, as in CC.
 */
import type { CcHookInput, CcHookOutcome, CcHookRegistry } from './contracts'
import { fileChangedWatchNames, matchesAnyField, matchesField, matchesNarrowField } from './matcher'
import type {
  CcAddedHooksRuntime,
  CcModelSwitch,
  PreModelSwitchResult,
} from './runtime-contracts-added'
import { contextFrom } from './runtime-results'
import type { HookDispatchDeps } from './runtime-tool-hooks'
import { clearCwdEnvFile, type CcSessionEnvFiles } from './session-env'

type SessionRunners = Omit<
  CcAddedHooksRuntime,
  | 'runUserPromptExpansion'
  | 'runPermissionRequest'
  | 'runPermissionDenied'
  | 'runPostToolBatch'
  | 'runTaskCreated'
  | 'runTaskCompleted'
  | 'runTeammateIdle'
  | 'hasHooks'
  | 'approveWithInput'
  | 'takeApprovedInput'
>

/**
 * The names a model-switch matcher is tested against: CC compares the canonical name of the
 * target, ignoring a `[1m]` suffix. A provider prefix (`anthropic/…`) and a trailing date stamp
 * are dropped to reach it; the id as written is tried too, so an exact id matcher still works.
 */
export function modelMatchNames(modelId: string): string[] {
  const bare = modelId.replace(/\[1m\]$/i, '').trim()
  const last = bare.split('/').pop() ?? bare
  const canonical = last.replace(/[-@]\d{8}$/, '')
  return [...new Set([canonical, last, bare])]
}

/** The last handler that named a watch list replaces the dynamic list (CC `watchPaths`). */
export function watchPathsFrom(outcomes: CcHookOutcome[]): { watchPaths?: string[] } {
  const named = outcomes.filter((o) => o.watchPaths !== undefined)
  const last = named[named.length - 1]
  return last?.watchPaths ? { watchPaths: last.watchPaths } : {}
}

export function createSessionHookRunners(
  deps: HookDispatchDeps,
  registry: CcHookRegistry,
  envFiles?: CcSessionEnvFiles,
): SessionRunners {
  const { runAll, baseInput } = deps

  const switchInput = (
    event: 'PreModelSwitch' | 'PostModelSwitch',
    change: CcModelSwitch,
  ): CcHookInput => ({
    ...baseInput(event),
    from_model: change.fromModel,
    to_model: change.toModel,
    requested_model: change.requestedModel,
    source: change.source,
  })
  const switchMatch = (change: CcModelSwitch) => (m: string | undefined) =>
    matchesAnyField(m, modelMatchNames(change.toModel))

  return {
    async runStopFailure(failure) {
      const input: CcHookInput = {
        ...baseInput('StopFailure'),
        error: failure.error,
        ...(failure.details ? { error_details: failure.details } : {}),
        ...(failure.message ? { last_assistant_message: failure.message } : {}),
      }
      // Notification only: CC ignores the output and the exit code.
      await runAll('StopFailure', (m) => matchesNarrowField(m, failure.error), input, false)
    },

    async runPostCompact(trigger, summary) {
      const input: CcHookInput = {
        ...baseInput('PostCompact'),
        trigger,
        compact_summary: summary,
      }
      await runAll('PostCompact', (m) => matchesField(m, trigger), input, false)
    },

    async runInstructionsLoaded(file) {
      const input: CcHookInput = {
        ...baseInput('InstructionsLoaded'),
        file_path: file.path,
        memory_type: file.memoryType,
        load_reason: file.loadReason,
      }
      await runAll('InstructionsLoaded', (m) => matchesField(m, file.loadReason), input, false)
    },

    async runConfigChange(source, filePath) {
      const input: CcHookInput = {
        ...baseInput('ConfigChange'),
        source,
        ...(filePath ? { file_path: filePath } : {}),
      }
      const outcomes = await runAll('ConfigChange', (m) => matchesField(m, source), input, false)
      // Managed policy always applies; its hooks only observe it.
      const blocked =
        source !== 'policy_settings' && outcomes.some((o) => o.blocked || o.decision === 'block')
      return { blocked }
    },

    async runCwdChanged(oldCwd, newCwd) {
      const input: CcHookInput = { ...baseInput('CwdChanged'), old_cwd: oldCwd, new_cwd: newCwd }
      // hooks.md: what CwdChanged and FileChanged hooks wrote to CLAUDE_ENV_FILE lasts "until the
      // next CwdChanged event, when Claude Code clears them".
      clearCwdEnvFile(envFiles)
      return watchPathsFrom(await runAll('CwdChanged', () => true, input, false))
    },

    async runFileChanged(filePath, event) {
      const input: CcHookInput = { ...baseInput('FileChanged'), file_path: filePath, event }
      const name = filePath.split(/[\\/]/).pop() ?? filePath
      return watchPathsFrom(
        await runAll('FileChanged', (m) => matchesNarrowField(m, name), input, false),
      )
    },

    async runPreModelSwitch(change) {
      const outcomes = await runAll(
        'PreModelSwitch',
        switchMatch(change),
        switchInput('PreModelSwitch', change),
        false,
      )
      // Precedence deny > ask > allow; a timed-out hook blocks the switch, as in CC.
      let result: PreModelSwitchResult = { decision: 'proceed' }
      for (const o of outcomes) {
        const denies =
          o.blocked ||
          o.decision === 'block' ||
          o.permissionDecision === 'deny' ||
          o.failed === 'timeout'
        if (denies) {
          return {
            decision: 'deny',
            reason:
              o.permissionDecisionReason ||
              o.blockReason ||
              o.reason ||
              (o.failed === 'timeout' ? 'A PreModelSwitch hook timed out' : undefined),
          }
        }
        if (o.permissionDecision === 'ask' && result.decision !== 'ask')
          result = { decision: 'ask', reason: o.permissionDecisionReason }
        else if (o.permissionDecision === 'allow' && result.decision === 'proceed')
          result = { decision: 'allow' }
      }
      return result
    },

    async runPostModelSwitch(change) {
      const additionalContext = contextFrom(
        await runAll(
          'PostModelSwitch',
          switchMatch(change),
          switchInput('PostModelSwitch', change),
          true,
        ),
      )
      return additionalContext ? { additionalContext } : {}
    },

    fileChangedWatchNames() {
      return [
        ...new Set((registry.FileChanged ?? []).flatMap((g) => fileChangedWatchNames(g.matcher))),
      ]
    },
  }
}
