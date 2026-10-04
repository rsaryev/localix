import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import type { AgentSettings } from '../user/contracts'
import type { ProjectSettings } from '../projects/contracts'
import type {
  ConfigDiagnostic,
  ConsumerResolution,
  ToolSurface,
  ToolSurfaceDenial,
} from './contracts'
import {
  MODEL_ROUTING_TASKS,
  isModelRoutingTaskEnabled,
  type ModelRoutingTaskKey,
} from '../chat/model-task-catalog'

/** A resolved model ({connectionId, modelId}) or null when nothing resolves. */
export type ResolvedModel = { providerConnectionId: string; modelId: string } | null

export interface ValidateInput {
  values: AgentSettings & ProjectSettings
  /** Is a session in scope at all? It decides whether an unset model route is a problem. */
  hasSession: boolean
  /**
   * Precomputed model resolutions keyed by consumer id (`session`, `modelRouting.<workload>`),
   * done by the service through the SAME runtime resolver the run pipeline uses.
   */
  resolvedModels: Record<string, ResolvedModel>
  /** Discovered skill names — to flag `skillOverrides` targeting a missing skill. */
  skillNames: string[]
  /** All built-in + plugin tool names known to the runtime (for disabledTools sanity). */
  knownToolNames?: string[]
  /**
   * What the scope turned off, from the capability resolver rather than from `values`.
   *
   * These stopped being settings: they are verdict rows now, and the report has to validate
   * the same answer the run gets rather than a copy that could disagree with it.
   */
  disabledTools?: string[]
  skillOverrides?: Record<string, string | undefined>
}

/** Static consumer catalog: every routed workload + how it behaves when unset. */
const ROUTE_CONSUMERS: {
  slot: Exclude<ModelRoutingTaskKey, 'session'>
  label: string
  /** Empty slot → the consumer falls back to the session's own model. */
  fallsBackToSession: boolean
  /** Empty slot → a non-model deterministic fallback (e.g. title truncation). */
  deterministicFallback?: string
}[] = MODEL_ROUTING_TASKS.flatMap((task) =>
  task.key === 'session'
    ? []
    : [
        {
          slot: task.key,
          label: task.label,
          fallsBackToSession: task.key !== 'titleGeneration',
          ...(task.key === 'titleGeneration'
            ? { deterministicFallback: 'first-message truncation' }
            : {}),
        },
      ],
)

/**
 * Project the authoritative tool catalog through the same settings deny-policy
 * the run pipeline consumes. Host-dependent assembly (for example an unavailable
 * preview host) still happens per run and is intentionally not guessed here.
 */
export function computeToolSurface(input: {
  disabledTools: string[]
  toolNames?: readonly string[]
  /**
   * Denials the settings policy cannot know because they are not policy at all —
   * currently "the plugin that owns this tool is disabled" (see tools/catalog.ts).
   * They win over a policy denial for the same name: a tool whose owner is gone is
   * absent no matter what the user's `disabledTools` say, so reporting the settings
   * reason would send a reader to a switch that changes nothing.
   */
  structuralDenials?: readonly ToolSurfaceDenial[]
}): ToolSurface {
  const catalogNames = [...new Set(input.toolNames ?? BUILTIN_TOOL_NAMES)]
  const denialByName = new Map<string, ToolSurfaceDenial>()
  for (const denial of input.structuralDenials ?? []) denialByName.set(denial.name, denial)
  // One reason left, because one thing switches a tool off: the scope's own rules, projected
  // into `disabledTools` by the capability resolver. A per-session "economy mode" used to add a
  // second, invisible one — a tool could be ON in Capabilities and absent from the turn.
  for (const name of input.disabledTools) {
    if (denialByName.has(name)) continue
    denialByName.set(name, {
      name,
      reason: 'disabled by settings (disabledTools)',
      source: 'settings',
    })
  }
  const enabled = catalogNames.filter((name) => !denialByName.has(name))
  const disabled = catalogNames.flatMap((name) => {
    const denial = denialByName.get(name)
    return denial ? [denial] : []
  })
  return { enabled, disabled }
}

/** Build the diagnostics + resolved consumers + tool surface. Pure. */
export function buildDiagnostics(input: ValidateInput): {
  diagnostics: ConfigDiagnostic[]
  consumers: ConsumerResolution[]
  tools: ToolSurface
} {
  const diagnostics: ConfigDiagnostic[] = []
  const consumers: ConsumerResolution[] = []
  const sessionModel = input.resolvedModels.session ?? null

  // Main session consumer.
  consumers.push({
    id: 'session',
    label: 'Main agent run',
    slotConfigured: false,
    providerConnectionId: sessionModel?.providerConnectionId ?? null,
    modelId: sessionModel?.modelId ?? null,
    usable: sessionModel != null,
    source: sessionModel ? 'session' : 'none',
    reason: sessionModel
      ? undefined
      : input.hasSession
        ? 'session model does not resolve to a usable connection'
        : 'no session in scope — session model not resolved',
  })
  if (input.hasSession && !sessionModel) {
    diagnostics.push({
      code: 'session_model_unresolved',
      severity: 'error',
      field: 'modelId',
      message: 'The session model does not resolve to a usable provider connection.',
    })
  }

  // Routed workload consumers.
  for (const def of ROUTE_CONSUMERS) {
    const id = `modelRouting.${def.slot}`
    const slot = input.values.modelRouting?.[def.slot]
    const slotConfigured = !!slot?.modelId
    const slotResolved = input.resolvedModels[id] ?? null

    if (!isModelRoutingTaskEnabled(input.values, def.slot)) {
      consumers.push({
        id,
        label: def.label,
        slotConfigured,
        providerConnectionId: slot?.providerConnectionId ?? null,
        modelId: slot?.modelId ?? null,
        usable: false,
        source: 'disabled',
        reason: 'workload is off in model routing',
      })
      continue
    }

    if (slotConfigured && slotResolved) {
      consumers.push({
        id,
        label: def.label,
        slotConfigured: true,
        providerConnectionId: slotResolved.providerConnectionId,
        modelId: slotResolved.modelId,
        usable: true,
        source: 'model-route',
      })
      continue
    }

    if (slotConfigured && !slotResolved) {
      // Configured but broken — falls back per the slot's semantics.
      const fell = def.fallsBackToSession ? sessionModel : null
      diagnostics.push({
        code: 'model_route_unresolved',
        severity: 'warning',
        field: id,
        message: `The configured "${def.label}" model does not resolve (deleted connection or model?).`,
      })
      consumers.push({
        id,
        label: def.label,
        slotConfigured: true,
        providerConnectionId: fell?.providerConnectionId ?? null,
        modelId: fell?.modelId ?? null,
        usable: def.fallsBackToSession ? fell != null : Boolean(def.deterministicFallback),
        source: def.fallsBackToSession ? (fell ? 'session' : 'none') : 'disabled',
        reason: def.fallsBackToSession
          ? 'configured workload model unresolved — using the session model'
          : `configured workload model unresolved — using ${def.deterministicFallback}`,
      })
      continue
    }

    // No slot configured — default behavior.
    if (def.deterministicFallback) {
      consumers.push({
        id,
        label: def.label,
        slotConfigured: false,
        providerConnectionId: null,
        modelId: null,
        usable: true,
        source: 'disabled',
        reason: `no workload model — ${def.deterministicFallback}`,
      })
    } else {
      // Falls back to the session model.
      consumers.push({
        id,
        label: def.label,
        slotConfigured: false,
        providerConnectionId: sessionModel?.providerConnectionId ?? null,
        modelId: sessionModel?.modelId ?? null,
        usable: input.hasSession ? sessionModel != null : true,
        source: sessionModel ? 'session' : input.hasSession ? 'none' : 'session',
        reason: input.hasSession ? undefined : 'inherits the session model at run time',
      })
    }
  }

  // disabledTools referencing an unknown tool name.
  const known = new Set(input.knownToolNames ?? BUILTIN_TOOL_NAMES)
  for (const name of input.disabledTools ?? []) {
    if (!known.has(name)) {
      diagnostics.push({
        code: 'disabled_tool_unknown',
        severity: 'info',
        field: 'disabledTools',
        message: `disabledTools names "${name}", which is not a built-in tool (a plugin tool, or a stale entry).`,
      })
    }
  }

  // skillOverrides referencing a skill that is not discovered.
  const skills = new Set(input.skillNames)
  for (const name of Object.keys(input.skillOverrides ?? {})) {
    if (!skills.has(name)) {
      diagnostics.push({
        code: 'skill_override_missing',
        severity: 'warning',
        field: 'skillOverrides',
        message: `skillOverrides targets "${name}", which is not currently discovered.`,
      })
    }
  }

  const tools = computeToolSurface({
    disabledTools: input.disabledTools ?? [],
    toolNames: input.knownToolNames,
  })

  return { diagnostics, consumers, tools }
}
