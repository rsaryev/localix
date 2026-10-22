/**
 * The per-run runtime surface of the events added after the first eleven. Each method fires
 * one Claude Code event and folds its handlers into the answer its dispatch point applies.
 */
import type { CcHookEvent } from './contracts'
import type { CcToolBatchCall } from './protocol-event-inputs'
import type { CcHookToolRef, StopResult } from './runtime-contracts'

/** A typed command that expanded into its prompt (UserPromptExpansion). */
export interface CcPromptExpansion {
  commandName: string
  commandArgs: string
  commandSource: string
  /** The line as typed. */
  prompt: string
}

/** What PermissionRequest handlers decided; no `behavior` leaves the card to the person. */
export interface PermissionRequestResult {
  behavior?: 'allow' | 'deny'
  /** `allow` only: replaces the whole tool input (re-validated where the call runs). */
  updatedInput?: unknown
  /** `deny` only: tells the model why. */
  message?: string
  /** `deny` only: stop the run as well. */
  interrupt?: boolean
}

export interface PostToolBatchResult {
  /** `decision:"block"`, `continue:false` or exit 2: end the loop before the next model call. */
  stop: boolean
  reason?: string
  /** Delivered once, before the next model call. */
  additionalContext?: string
}

/** A task-board card (TaskCreated / TaskCompleted). */
export interface CcTask {
  id: string
  subject: string
  description?: string
  teammateName?: string
}

export interface TeammateIdleResult {
  /** Exit 2 (or a prompt/agent verdict): the member keeps working with `reason` as feedback. */
  blocked: boolean
  reason?: string
  /** `continue:false`: the member stops; `stopReason` is shown to the person. */
  stopReason?: string
}

/** One model switch (PreModelSwitch / PostModelSwitch). */
export interface CcModelSwitch {
  fromModel: string
  toModel: string
  requestedModel: string | null
  source: 'command' | 'picker'
}

export interface PreModelSwitchResult {
  /** `deny` (exit 2, `decision:"block"`, a timeout) cancels; `ask` has no prompt here, so it refuses too. */
  decision: 'allow' | 'deny' | 'ask' | 'proceed'
  reason?: string
}

export interface CcAddedHooksRuntime {
  /** Whether any handler is registered for the event (skips work done only to feed it). */
  hasHooks(event: CcHookEvent): boolean
  /** A typed slash command expanded; may block it (stops at the first block) or add context. */
  runUserPromptExpansion(expansion: CcPromptExpansion): Promise<{
    blocked: boolean
    reason?: string
    additionalContext?: string
  }>
  /** An approval card is about to wait on the person. Exit 2 is not honoured, as in CC. */
  runPermissionRequest(
    /** The tool itself carries its `mcp__…` aliases and MCP server; a bare name has neither. */
    tool: CcHookToolRef,
    input: unknown,
    opts?: { suggestions?: unknown[] },
  ): Promise<PermissionRequestResult>
  /** Hand a call a PermissionRequest hook allowed its rewritten input (CC `updatedInput`). */
  approveWithInput(toolCallId: string, input: unknown): void
  /** The rewrite an approval hook handed this call, once; re-validated by the caller. */
  takeApprovedInput(toolCallId: string): { input: unknown } | undefined
  /** A call was refused without asking anyone; `retry` tells the model it may try again. */
  runPermissionDenied(
    tool: CcHookToolRef,
    input: unknown,
    toolUseId: string,
    reason: string,
  ): Promise<{ retry: boolean }>
  /** Every call of one model response resolved, before the next model request. */
  runPostToolBatch(calls: readonly CcToolBatchCall[]): Promise<PostToolBatchResult>
  /** The turn ended on a provider error. Output is ignored, as in CC. */
  runStopFailure(failure: { error: string; details?: string; message?: string }): Promise<void>
  /** A card was put on the task board; `blocked` takes it off again. */
  runTaskCreated(task: CcTask): Promise<StopResult>
  /** A card is about to close; `blocked` leaves it open. `continue:false` is ignored on this path. */
  runTaskCompleted(task: CcTask): Promise<StopResult>
  /** A conversation member (not the leader) finished its turn. */
  runTeammateIdle(teammate: { name: string; agentId: string }): Promise<TeammateIdleResult>
  /** A context checkpoint was taken (this host's compaction). Observer-only. */
  runPostCompact(trigger: 'manual' | 'auto', summary: string): Promise<void>
  /** One instruction file entered the prompt. Observer-only. */
  runInstructionsLoaded(file: {
    path: string
    memoryType: 'User' | 'Project'
    loadReason: 'session_start' | 'compact'
  }): Promise<void>
  /** Configuration changed; `blocked` keeps the change from applying. */
  runConfigChange(source: string, filePath?: string): Promise<StopResult>
  /** The session's working directory changed. */
  runCwdChanged(oldCwd: string, newCwd: string): Promise<{ watchPaths?: string[] }>
  /** A watched file changed on disk. */
  runFileChanged(
    filePath: string,
    event: 'change' | 'add' | 'unlink',
  ): Promise<{ watchPaths?: string[] }>
  /** Before a requested model switch applies. */
  runPreModelSwitch(change: CcModelSwitch): Promise<PreModelSwitchResult>
  /** After the switch; the context reaches the model with the next request. */
  runPostModelSwitch(change: CcModelSwitch): Promise<{ additionalContext?: string }>
  /** The literal filenames the registry's `FileChanged` matchers name, for the watcher. */
  fileChangedWatchNames(): string[]
}
