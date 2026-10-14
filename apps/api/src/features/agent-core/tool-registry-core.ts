// Baseline tool factories and the run context they are built from — the sibling
// of tool-registry-optionals.ts (which owns factories that need an injected host
// dependency). "Baseline" is construction topology, never toggle policy: every
// result still passes through the same disabledTools filter.
//
// tool-registry.ts is left with what it is actually about: ASSEMBLY — profile
// gating, disabledTools, and the prompt roster.

import type { AgentTool } from '@localixai/agent/agents'
import { createAskTool } from './tools/hitl/ask'
import { createBashTool } from './tools/bash/bash'
import { createReadTool } from './tools/file/read'
import { createFileMtimeStore, type FileMtimeStore } from './tools/file/file-utils'
import { createSearchTool } from './tools/file/search'
import { createWriteTool } from './tools/file/write'
import { createEditTool } from './tools/file/edit'
import { createResearchTool } from './tools/web/research'
import { CHAT_RUN_PROFILE, hasToolFeature, isToolLive, type RunProfile } from './run-shape'
import { TOOL } from './tool-names'
import type { RuntimeToolRegistryOptions } from './tool-registry'

/** A registry row wraps the single authoritative tool descriptor. */
export interface RegistryEntry {
  tool: AgentTool
}

/**
 * Values DERIVED from the options that both the core-tool table and the assembly
 * need. Computing them once, in one place, keeps the derivation rules (especially
 * `allowBackgroundBash`, which composes three) out of the assembly's way.
 */
export interface RegistryContext {
  agentProfile: RunProfile
  disabled: Set<string>
  /** Whether bash may spawn background jobs this run (composed from three rules). */
  allowBackgroundBash: boolean
  /** The run's one bash instance. */
  bashTool: ReturnType<typeof createBashTool>
  /** One store per registry = one per session run: read/write/edit share it. */
  fileMtimes: FileMtimeStore
}

export function buildRegistryContext(options: RuntimeToolRegistryOptions): RegistryContext {
  const policy = options.policy ?? {}
  const core = options.core ?? {}
  const agentProfile = policy.agentProfile ?? CHAT_RUN_PROFILE
  const disabled = new Set(policy.disabledTools ?? [])
  // A background job is a long-running process that outlives the turn that launched it, so
  // it is gated separately from `bash` itself: a run may investigate with the shell and
  // still have no business leaving a dev server behind. Dropping the FIELD (not just
  // denying the call) means the model never spends a turn — and a HITL prompt — proposing
  // one, and the `bash` schema stops advertising a capability this run does not have.
  const allowBackgroundBash =
    // Default DERIVED, not `true`: a background job is unmanageable without its `jobs`
    // manager (a scope can switch it off), so the registry answers that itself rather than
    // trusting a caller to remember. The chat runtime still passes an explicit value.
    (core.allowBackgroundBash ?? isToolLive(agentProfile, TOOL.jobs, policy.disabledTools ?? [])) &&
    hasToolFeature(agentProfile, 'bash', 'background')

  const bashTool = createBashTool(core.env, core.defaultCwd, {
    allowBackground: allowBackgroundBash,
    spawnTerminalJob: core.spawnTerminalJob,
    terminalControl: core.terminalControl,
    pluginBinDirs: core.bashPluginBinDirs,
    waitHost: core.bashWaitHost,
  })

  return {
    agentProfile,
    disabled,
    allowBackgroundBash,
    bashTool,
    fileMtimes: core.fileMtimes ?? createFileMtimeStore(),
  }
}

/**
 * Baseline tools — constructed for every registry (then subject to the profile,
 * surface, mode, and user's disabledTools gates in assembly). Each contributes ONE roster
 * line; per-tool USAGE detail lives in the tool's own JSON schema, the single home
 * the model reads when calling it.
 */
export function buildCoreTools(
  options: RuntimeToolRegistryOptions,
  ctx: RegistryContext,
): RegistryEntry[] {
  const core = options.core ?? {}
  const { env, defaultCwd, reportDiagnostics, editorBuffer } = core
  const { bashTool, fileMtimes } = ctx
  // Cross-file edit concurrency (Codex-style stacked edits): when this run does NOT
  // confirm every mutation, file tools run concurrently across different paths (the
  // loop's scheduler orders calls whose `parallelScopePaths` overlap, and per-path
  // mutation locks serialize each read-modify-write).
  // A run that confirms every mutation stays sequential so HITL confirms arrive one at
  // a time instead of as a burst. The caller decides, from the effective permission
  // rules; parallel is the default because confirm-everything is the exception.
  const fileToolConcurrency = { parallel: options.policy?.parallelFileTools ?? true }

  return [
    {
      tool: createAskTool(core.askQueue),
    },
    {
      tool: bashTool,
    },
    {
      tool: createReadTool(
        env,
        defaultCwd,
        core.readOutline,
        core.readDocumentExtractor,
        fileMtimes,
        editorBuffer,
      ),
    },
    {
      tool: createSearchTool(env, defaultCwd),
    },
    {
      tool: createWriteTool(
        env,
        defaultCwd,
        reportDiagnostics,
        fileToolConcurrency,
        fileMtimes,
        editorBuffer,
      ),
    },
    {
      tool: createEditTool(
        env,
        defaultCwd,
        reportDiagnostics,
        fileToolConcurrency,
        fileMtimes,
        editorBuffer,
      ),
    },
    {
      // One keyless, composite network capability: metasearch → rank → safe page
      // reads. The lower-level fetch/search adapters are not model-facing tools.
      tool: createResearchTool({ config: core.researchConfig }),
    },
  ]
}
