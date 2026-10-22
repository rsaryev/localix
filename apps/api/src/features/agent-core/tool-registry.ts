import type { SetTopicPort } from './tools/set-topic'
import type { AgentTool, ToolSurface } from '@localixai/agent/agents'
import type { ScriptSandbox } from '@localixai/agent/runtime'
import type { BrowserToolDeps } from './tools/browser/browser'
import type { FileMtimeStore } from './tools/file/file-utils'
import type { DocumentTextExtractor } from './tools/file/document-ports'
import type { ResearchConfig } from './tools/web/research'
import type { DiagnosticsReporter, EditorBufferProbe } from './tools/file/file-utils'
import type { OutlineProvider } from './tools/file/outline'
import type { DelegateToolPort } from './tools/delegate'
import type { AgentsToolPort } from './tools/agents'
import type { LoopsToolOptions } from './tools/loops'
import type { PluginBuildToolOptions } from './tools/plugin-build'
import type { ConfigureToolOptions } from './tools/configure/configure'
import type { PlanToolOptions } from './tools/plan/plan'
import type { BashWaitHost } from './tools/bash/bash-until'
import type { TerminalToolDeps } from './tools/terminal/terminal'
import type { ExecutionEnvironment } from './tools/environment'
import type { SpawnTerminalJob } from './tools/terminal/terminal-job'
import type { RunProfile } from './run-shape'
import { BUILTIN_TOOL_NAMES, TOOL } from './tool-names'
import { createCodemodeTool } from './tools/codemode/codemode'
import type { WorkflowToolPort } from './tools/workflow/workflow'
import { buildCoreTools, buildRegistryContext, type RegistryEntry } from './tool-registry-core'
import { buildNamedOptionals } from './tool-registry-optionals'
import {
  isLive,
  resolveToolSurface,
  type PolicyDenial,
  type ToolCandidate,
  type ToolLedger,
} from './tool-ledger'

/**
 * WHICH tools a run may see. Policy only — nothing here builds a tool.
 */
export interface ToolRegistryPolicy {
  /**
   * Capabilities of the client/runtime surface for this run. When supplied, a
   * tool whose descriptor requirements are unmet is removed before the model
   * and dispatch projections. Omitted keeps the unscoped behavior for
   * non-runtime callers and focused unit tests.
   */
  toolSurface?: ToolSurface
  /** Plugin/MCP native tools injected by the host; profile and surface gates still apply. */
  extraTools?: readonly AgentTool[]
  /** Tool names to exclude from the runtime. Excluded tools are invisible to the agent. */
  disabledTools?: readonly string[]
  /** The denying rule behind each `disabledTools` entry, when the host resolved one. */
  toolDenials?: ReadonlyMap<string, PolicyDenial>
  /**
   * Why the host left an optional port EMPTY, by tool name. A port
   * the host did not explain is recorded as `host:<name>` — present, never silent.
   */
  missingCapabilities?: Readonly<Record<string, string>>
  /**
   * Built tools the host withholds from THIS run, each with the capability the run lacks — a
   * person to answer `ask`, say, in a session nobody watches. Withheld like an empty port: the
   * model is told the host does not provide it, and nothing in the prompt names it.
   */
  withheldByHost?: Readonly<Record<string, string>>
  /** Declarative role profile that decides which tools are visible before user/project disabledTools apply. */
  agentProfile?: RunProfile
  /** What this run's model reads; drives the ledger's `model` layer and each tool's `forModel`. */
  modelInput?: readonly string[]
  /**
   * May file tools run concurrently across different paths? False when this run confirms
   * every mutation, so the confirms arrive one at a time instead of as a burst the user
   * cannot answer in order. Derived from the effective permission rules by the caller —
   * the registry cannot evaluate rules and must not guess from a mode that no longer exists.
   */
  parallelFileTools?: boolean
}

/**
 * What the ALWAYS-BUILT tools (ask, bash, read, search, write, edit, research) need
 * from the host. Every field is optional: a bare registry builds them with local defaults,
 * which is what focused tests rely on.
 */
export interface CoreToolDeps {
  /** Execution environment for bash/read/write/edit/search tools. Defaults to local. */
  env?: ExecutionEnvironment
  defaultCwd?: string
  /** Disable background bash in sub sessions to prevent nested jobs. */
  allowBackgroundBash?: boolean
  /** When set, background bash jobs run in a real PTY pane via this host (already bound to user+session). */
  spawnTerminalJob?: SpawnTerminalJob
  /** Enables `bash`'s interactive-terminal actions (open/screen/keys/type). Bound to user+session. */
  terminalControl?: TerminalToolDeps
  /** Record a dev-server URL a background bash job advertised, for the lazy browser
   *  auto-open, along with the command that produced it so a stopped preview can be relaunched. */
  /** Enabled plugins' `bin/` directories, appended to PATH for bash subprocesses. Injected as DATA. */
  bashPluginBinDirs?: string[]
  /** Engine for `bash` `until` waits (poll + wake). Bound to user+session; absent → unavailable. */
  bashWaitHost?: BashWaitHost
  /** Keyless research runtime policy. No provider credentials are accepted. */
  researchConfig?: Partial<ResearchConfig>
  /**
   * Async hook called by write/edit after a successful write: notifies the language
   * server, waits for diagnostics, and returns an error block the tool appends to its result.
   */
  reportDiagnostics?: DiagnosticsReporter
  /**
   * read/write/edit: a note when the file is open in the person's editor with
   * unsaved edits the disk text lacks. No schema — a result annotation, like diagnostics.
   */
  editorBuffer?: EditorBufferProbe
  /** `read`'s outline mode: a file's language-server document symbols. Null = no server covers it. */
  readOutline?: OutlineProvider
  /** Session-scoped read/write bookkeeping shared by read + write + edit. */
  fileMtimes?: FileMtimeStore
  /** Office/spreadsheet text extraction for `read`. */
  readDocumentExtractor?: DocumentTextExtractor
}

/**
 * THE optional-tool ports, keyed by the tool's catalog NAME. One key per optional built-in;
 * the value is what that tool needs from the host — a ready instance where construction
 * needs host repositories, an options object where the registry constructs it. The shape is
 * pinned by `tool-port-shape.test.ts`: every key is a catalogued name, and every optional
 * built-in has exactly one key and exactly one registration branch.
 */
export interface OptionalToolPorts {
  /** Read-only budget report over the host's frame + last measurement; absent when no frame. */
  context_budget?: AgentTool
  memory?: AgentTool
  /** The search palette's service, bound to the run's session and project. */
  global_search?: AgentTool
  tool_output?: AgentTool
  skill?: AgentTool
  jobs?: AgentTool
  /** Tasks handed to child sessions, and the line to each child (`tools/delegate.ts`). */
  delegate?: DelegateToolPort
  agents?: AgentsToolPort
  loops?: LoopsToolOptions
  /** The host's plugin authoring: build, test and reload (or create) one user plugin. */
  plugin_build?: PluginBuildToolOptions
  browser?: BrowserToolDeps
  /** The chat's topic boundary, built for the leader or sole participant of a chat. */
  set_topic?: SetTopicPort
  /** The participant's pass, built for a chat with more than one participant. */
  skip_answer?: AgentTool
  /** Inspect the ledger and propose configuration changes through a HITL request. */
  configure?: ConfigureToolOptions
  /** The conversation's plan — present / read / complete, stored by the host's plans. */
  plan?: PlanToolOptions
  /** The engine's script sandbox (`AgentEngine.scripts`), which `codemode` runs scripts in. */
  codemode?: ScriptSandbox
  /** Plugin workflows: their sandbox and the chat's children (`tools/workflow/workflow.ts`). */
  workflow?: WorkflowToolPort
}

/**
 * Three bags, one pattern. There used to be 40 flat fields of three unrelated shapes
 * (ready instances, options objects, loose callbacks) and nothing said which tool a field
 * belonged to or whether a new tool had been wired everywhere it needed to be.
 */
export interface RuntimeToolRegistryOptions {
  policy?: ToolRegistryPolicy
  core?: CoreToolDeps
  optional?: OptionalToolPorts
}

export interface RuntimeToolRegistry {
  /** Enabled tool descriptors used by both the model schema and runtime dispatch. */
  tools: readonly AgentTool[]
  toolNames: readonly string[]
  promptSection: string
  /** One verdict per candidate, including every tool this run does NOT get and why. */
  ledger: ToolLedger
}

// The model already receives every tool's name, description and input schema through
// the provider tool channel. Repeating descriptions here double-bills the most verbose
// schemas (especially plugin tools) before the user sends a single token. Keep only an
// exhaustive name roster for capability linting and at-a-glance discovery; the schema
// remains the single source of truth for semantics and usage.
export function formatToolRoster(names: readonly string[]): string {
  return ['# Available tools', ...names.map((name) => `- ${name}`)].join('\n')
}

/**
 * The registry as the MODEL sees it once deferral has run: only the tools on the wire, in wire
 * order, the activator included. The registry itself lists every plugin tool it built, and a
 * roster taken from it named deferred tools the model held no schema for — beside a "# Plugins"
 * line calling them direct and an `activate_tools` catalog listing them again.
 */
export function onTheWire(
  registry: RuntimeToolRegistry,
  wireToolNames: readonly string[] | undefined,
): RuntimeToolRegistry {
  if (!wireToolNames) return registry
  return { ...registry, toolNames: wireToolNames, promptSection: formatToolRoster(wireToolNames) }
}

export function createRuntimeToolRegistry(
  options: RuntimeToolRegistryOptions = {},
): RuntimeToolRegistry {
  const policy = options.policy ?? {}
  const ctx = buildRegistryContext(options)
  const { agentProfile, disabled } = ctx

  const coreTools = buildCoreTools(options, ctx)
  const namedOptionals = buildNamedOptionals(options, ctx)

  // Every built-in is a CANDIDATE, built or not: a port the host left empty still gets a row,
  // so "the tool is simply not there" is no longer a state the ledger can express.
  // extraTools are an EXPLICIT injection (plugin native tools, and the core-NAMED tools a
  // host owns — `vault`, `external_agent_sessions`). On an OPEN profile the caller decided to expose
  // every enabled plugin tool; on a CLOSED profile (an unattended worker) a plugin tool
  // survives only when the role declared it — the ledger's shape layer applies exactly that
  // rule, reading each tool's own `exposure`.
  const extraTools = (policy.extraTools ?? []).filter((tool): tool is AgentTool => Boolean(tool))
  const built = new Map<string, AgentTool>()
  for (const entry of [...coreTools, ...namedOptionals]) built.set(entry.tool.name, entry.tool)
  for (const tool of extraTools) if (!built.has(tool.name)) built.set(tool.name, tool)
  const withheld = policy.withheldByHost ?? {}
  for (const name of Object.keys(withheld)) built.delete(name)
  const candidates: ToolCandidate[] = BUILTIN_TOOL_NAMES.map((name) => {
    const missingCapability = withheld[name] ?? policy.missingCapabilities?.[name]
    return {
      name,
      ...(built.has(name) ? { tool: built.get(name)! } : {}),
      ...(missingCapability ? { missingCapability } : {}),
    }
  })
  for (const tool of extraTools) candidates.push({ name: tool.name, tool })

  const ledger = resolveToolSurface(
    {
      profile: agentProfile,
      authority: policy.toolSurface?.capabilities,
      disabledTools: disabled,
      toolDenials: policy.toolDenials,
      modelInput: policy.modelInput,
    },
    candidates,
  )

  // One paired list so a filter keeps tool and descriptor aligned. The ledger is the only
  // filter: nothing below re-derives a verdict. A live tool with a model-dependent part then
  // takes its variant for this model (`forModel`), so the schema offers only what it can use.
  const { modelInput } = policy
  const entries: RegistryEntry[] = [
    ...coreTools,
    ...namedOptionals,
    ...extraTools.map((tool) => ({ tool })),
  ]
    .filter((entry) => isLive(ledger, entry.tool.name))
    .map((entry) =>
      modelInput && entry.tool.forModel
        ? { ...entry, tool: entry.tool.forModel(modelInput) }
        : entry,
    )

  // `codemode` declares the tools its scripts call, so it is built from the live ones: a tool this
  // run does not have is never declared.
  const live = entries.map((e) => e.tool)
  const scripts = options.optional?.codemode
  const tools = scripts
    ? live.map((tool) => (tool.name === TOOL.codemode ? createCodemodeTool(scripts, live) : tool))
    : live
  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    promptSection: formatToolRoster(tools.map((tool) => tool.name)),
    ledger,
  }
}
