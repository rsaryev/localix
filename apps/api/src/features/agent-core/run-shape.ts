import {
  DEFAULT_TOOL_EXPOSURE,
  type ExposureLevel,
  type RunShape,
  type ToolExposure,
} from '@localixai/agent/agents'
import {
  BUILTIN_TOOL_NAMES,
  MCP_RESOURCE_TOOL_NAMES,
  TOOL,
  builtinToolExposure,
  type ToolName,
} from './tool-names'
import { DESCRIPTIONS, GUIDANCE, NON_INTERACTIVE_BASH_FEATURES } from './run-shape-surfaces'

/**
 * The SHAPE of a run — everything a run needs to know that its agent cannot tell it.
 *
 * There is one agent system, and this is not it: WHO is running is the agent record
 * (`features/agents`), and the runtime takes that record as input. What a record can never
 * answer is the other half of a dispatch — is a human watching this, may a detached process
 * outlive it, is the tool surface allowed to grow with whatever MCP servers happen to be
 * connected. The same shipped agent needs different answers in a chat and in a delegated child,
 * so those answers belong to the HOST that dispatched it.
 *
 * This module used to be `agent-profile.ts` and held a table of four named roles, each with
 * its own identity sentence, tool list and guidance — a second roster of agents living beside
 * the registry, which is exactly the duplication that let a dispatcher and Settings disagree
 * about the same name. What remains is a derivation, not a roster: give it the session kind
 * and the agent, and it computes the surface.
 *
 * WHICH tools a shape may carry is not decided here either: every catalog entry declares its
 * own `exposure` per shape (`tool-names.ts`, `AgentTool.exposure` for mini app tools), and this
 * module only reads it. The per-shape allowlists that used to live beside this file were a
 * second answer to the same question, kept in sync by hand.
 */

export type AgentSessionKind = 'chat' | 'subagent' | 'job' | 'system'

export type { RunShape } from '@localixai/agent/agents'

type ToolVisibility = 'direct' | 'hidden'

/**
 * The slice of an agent record this derivation reads.
 *
 * Deliberately structural and tiny: `agent-core` must not import the registry (see
 * `agnostic-boundary.test.ts`), and a run needs to know only what the agent DECLARED about
 * its surface. Everything else about the agent — who it is, its model, its limits — travels
 * on its own paths.
 */
export interface RunAgent {
  /** Candidate tool roster. Absent inherits host defaults; empty does not. */
  tools?: readonly string[]
  /** The agent's own system prompt — the run's identity. */
  prompt?: string
  /**
   * A delegated child run as a Claude Code plugin agent type that lists no `tools`: as there, it
   * "inherits every tool available to subagents" — the main conversation's MCP and mini app tools
   * too (`chat/runtime/run-profile.ts`). Ignored with a `tools` list and outside a subagent.
   */
  inheritsConversationTools?: boolean
}

export interface RunProfile {
  shape: RunShape
  description: string
  /**
   * Keyed by an OPEN vocabulary: built-in names AND mini app/MCP tool names, which are
   * unknown at compile time (an agent declares its own `tools` list). Read it through
   * {@link isToolDirect} (typed, for a built-in) or {@link declaresTool} (untyped, for a
   * name that only exists at runtime) — never by indexing.
   */
  toolExposure: Record<string, ToolVisibility>
  /**
   * What the agent record declared for this run, or `null` when the shape's defaults apply
   * (a chat, or a record with no list). Kept so the ledger can tell "not declared" from
   * "declared but the shape can never carry it".
   */
  declaredTools: readonly string[] | null
  /** Per-tool feature switches. Built-ins only — a mini app tool has no host-known features. */
  disabledToolFeatures?: Partial<Record<ToolName, readonly string[]>>
  /**
   * May this run receive MCP tools (which are dynamic, so they can't be listed in
   * `toolExposure`)? Only an open-ended CHAT opts in: it is the run a human is watching,
   * where an unanticipated MCP server is the point. Every unattended run is a CLOSED
   * allowlist by design — MCP tools bypass the registry's profile filter otherwise, bloating
   * every worker's tool payload with servers it will never use, on every turn, multiplied by
   * the number of workers. Undefined = closed. The one exception is a child that inherits the
   * conversation's tools ({@link RunProfile.inheritsConversation}).
   */
  openToolset?: boolean
  /**
   * A subagent that takes the tools a chat admits by default beside its shape's built-ins: MCP
   * tools, mini app and mod tools whose chat exposure is `default` (`tool-ledger.ts`).
   */
  inheritsConversation?: boolean
  prompt: RunPromptProfile
}

export interface RunPromptProfile {
  identity: string
  roleGuidance: readonly string[]
}

const DIRECT = 'direct' as const

function directTools(names: readonly string[]): Record<string, ToolVisibility> {
  return Object.fromEntries(names.map((name) => [name, DIRECT]))
}

/**
 * The exposure of ANY tool name for a shape: the catalog's answer for a built-in, the
 * mini app default for a name the catalog does not know (a mini app tool's own `exposure`
 * is read off the tool OBJECT by the ledger, which is the only place that holds it).
 */
export function exposureLevel(
  shape: RunShape,
  toolName: string,
  exposure: ToolExposure | undefined = builtinToolExposure(toolName),
): ExposureLevel {
  return (exposure ?? DEFAULT_TOOL_EXPOSURE)[shape]
}

/** The built-ins a shape carries when its agent declared nothing. Derived, never listed. */
export function shapeDefaultTools(shape: RunShape): string[] {
  return BUILTIN_TOOL_NAMES.filter((name) => exposureLevel(shape, name) === 'default')
}

/**
 * Every run's wire is compressed by the same pipeline, and an elided tool result advertises
 * `ToolOutput(action="get", tool_call_id="…")`. A surface built from a CUSTOM tool list
 * would otherwise receive those pointers without the tool — a dead recovery path that leaves
 * the agent re-reading whole files or burning a turn on a not_found error. The tool is
 * read-only and scoped to the agent's own session. This adds a candidate only: effective
 * policy still filters it, and run preparation must reject an unavailable recovery operation.
 */
function withElisionRecovery(names: readonly string[]): string[] {
  const out = [...names]
  if (!out.includes(TOOL.ToolOutput)) out.push(TOOL.ToolOutput)
  return out
}

/** Which host is running this. `system` is a passive thread that must never run an agent;
 *  it maps to the most locked-down shape defensively, in case it ever is invoked. */
export function runShapeOf(sessionKind: AgentSessionKind): RunShape {
  switch (sessionKind) {
    case 'subagent':
      return 'subagent'
    // Job sessions RUNNING AGENT LOOPS (recurring and engine-dispatched automation) are
    // unattended runs with a real tool surface; `system` threads never invoke the model.
    case 'job':
    case 'system':
      return 'automation'
    case 'chat':
      return 'chat'
  }
}

/**
 * THE one entry point: an agent plus the host that dispatched it, resolved into a surface.
 *
 * It replaced three per-dispatcher profile builders that answered the same question
 * differently, which is how one agent ended up with different tool rules depending on who
 * started it.
 *
 * `agent` absent means no record answered (a host that passes none, a handle that no longer
 * resolves): the shape's own floor applies.
 */
export function resolveRunProfile(
  session: { sessionKind: AgentSessionKind },
  agent?: RunAgent | null,
): RunProfile {
  const shape = runShapeOf(session.sessionKind)
  // A CHAT does not read the agent's tool list here, and that is not an inconsistency.
  // A record's list reaches a chat through its own capability scope (`agent:<handle>`),
  // which `capabilities/seed-agent-presets.ts` seeds ONCE and the user then owns — so a tool
  // switched back on in Capabilities stays on. Enforcing the same list a second time from
  // the run surface would silently overrule that screen, which is the exact failure the
  // seed-don't-overlay rule exists to prevent. An unattended run has no such screen in the
  // loop and applies the declaration directly, as it always has.
  // An explicit empty host roster must not restore shell/file defaults.
  const declared = shape === 'chat' || agent?.tools == null ? null : [...agent.tools]
  const inherits =
    shape === 'subagent' && declared === null && agent?.inheritsConversationTools === true
  // A declaration is taken as written — that is how a role opts into a tool — EXCEPT a name
  // the catalog marks `never` for this shape: no agent may grant itself the user-blocking
  // tools in an unattended run. The ledger reports the rejection; here it is simply not a
  // candidate.
  // An inheriting child also reads its MCP servers' resources, as the chat does.
  const defaults = [...shapeDefaultTools(shape), ...(inherits ? MCP_RESOURCE_TOOL_NAMES : [])]
  const names = withElisionRecovery(
    (declared ?? defaults).filter((name) => exposureLevel(shape, name) !== 'never'),
  )
  const guidance = [...GUIDANCE[shape]]
  return {
    shape,
    description: DESCRIPTIONS[shape],
    toolExposure: directTools(names),
    declaredTools: declared,
    // Open only in a chat. Every unattended run is a closed surface, whether or not its
    // agent enumerated tools: whether the author bothered to list them says nothing about
    // whether a human is watching — and nobody is. Each extra schema bloats prefill on
    // every turn of every child and dilutes its focus. A plugin agent type without a `tools`
    // list is the exception its author chose: Claude Code's subagents inherit the chat's tools.
    openToolset: shape === 'chat' || inherits,
    ...(inherits ? { inheritsConversation: true } : {}),
    ...(shape === 'chat'
      ? {}
      : {
          disabledToolFeatures: {
            [TOOL.Bash]: NON_INTERACTIVE_BASH_FEATURES,
          },
        }),
    prompt: { identity: agent?.prompt?.trim() ?? '', roleGuidance: guidance },
  }
}

/** The surface an ordinary chat gets before anything narrows it — the default for callers
 *  (prompt builders, the tool registry) that have no session in hand. */
export const CHAT_RUN_PROFILE: RunProfile = resolveRunProfile({ sessionKind: 'chat' })

/** Must the run gather MCP servers: an open toolset, or a list that names an MCP tool. */
export function gathersMcpTools(profile: RunProfile): boolean {
  return profile.openToolset === true || !!profile.declaredTools?.some((n) => n.startsWith('mcp'))
}

export function toolExposure(profile: RunProfile, toolName: string): ToolVisibility {
  return profile.toolExposure[toolName] ?? 'hidden'
}

/**
 * Is this tool exposed DIRECTLY — for a name only known at RUNTIME?
 *
 * The open half of the vocabulary: mini app and MCP tool names, which no type can
 * enumerate. Callers iterate over tool OBJECTS rather than re-typing a name, so there is
 * no name to get wrong. Everything else must use {@link isToolDirect}, which is typed.
 */
export function declaresTool(profile: RunProfile, toolName: string): boolean {
  return toolExposure(profile, toolName) === 'direct'
}

/**
 * Is this BUILT-IN tool exposed directly?
 *
 * The name is a {@link ToolName}, not a `string`, and that is the whole point. This
 * predicate is the gate every optional tool's wiring hangs off (`runtime-tools.ts`
 * wraps each one in `isToolDirect(profile, "x") && …`), and it FAILS OPEN-ENDEDLY: a
 * name that matches nothing simply returns false, so the tool is built, registered,
 * and then silently hidden from the model. No error, no test failure — the agent just
 * stops seeing it. Renaming a `TOOL.x` key used to do exactly that at every call site
 * that had re-typed the name as a bare string (21 of them in `features/chat` alone).
 * Typing the parameter turns that class of silent disablement into a compile error.
 */
export function isToolDirect(profile: RunProfile, toolName: ToolName): boolean {
  return declaresTool(profile, toolName)
}

/**
 * Whether a tool will actually reach the model: it must be exposed DIRECTLY AND survive the
 * runtime `disabledTools` filter (a scope's own switches feed that list). Mirrors the
 * two-stage gating the registry applies, so callers that need to know if a tool is *live* —
 * not merely declared — don't re-derive it. (Used to pair a launcher tool with its manager,
 * e.g. background bash requires a live `Jobs` tool.)
 */
export function isToolLive(
  profile: RunProfile,
  toolName: ToolName,
  disabledTools: readonly string[],
): boolean {
  return isToolDirect(profile, toolName) && !disabledTools.includes(toolName)
}

export function hasToolFeature(profile: RunProfile, toolName: ToolName, feature: string): boolean {
  return !(profile.disabledToolFeatures?.[toolName] ?? []).includes(feature)
}
