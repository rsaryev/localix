import type { ToolExposure } from './tool-exposure'
import type { z } from 'zod'
import type {
  AssistantMessage,
  ToolErrorPayload,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  FileContent,
} from '..'
import type { HumanInLoopController } from './human-in-loop'
import type { AgentSource } from './sources'
import type { CallClass } from './call-class'

// ---- Agent messages ------------------------------------------------------------
// Extend this via declaration merging to add custom message types:
//
//   declare module '@localixai/agent/agents' {
//     interface CustomAgentMessages {
//       notification: { role: 'notification'; text: string; timestamp: number }
//     }
//   }
//
// Custom messages are filtered out by convertToLlm before sending to the model.

export interface BaseAgentMessages {
  user: UserMessage
  assistant: AssistantMessage
  tool: ToolResultMessage
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomAgentMessages {}

export type AgentMessageMap = BaseAgentMessages & CustomAgentMessages
export type AgentMessage = AgentMessageMap[keyof AgentMessageMap]

// ---- Agent tools ---------------------------------------------------------------

export type AgentToolUpdateCallback<TDetails = unknown> = (details: Partial<TDetails>) => void

export interface AgentToolResult<TDetails = unknown> {
  content: string
  /**
   * Compact provenance for resources that informed this result. This is persisted
   * for presentation but is never replayed as model content; tools put the actual
   * evidence in `content`.
   */
  sources?: AgentSource[]
  /**
   * Optional model-facing multimodal content (images / documents) for tools that
   * load media into context (e.g. an image handled by `read`). When present, these parts are
   * sent to the model in place of the plain `content` string; `content` remains the
   * human-readable summary shown in the UI tool card and the text fallback for
   * providers (or non-vision models) that can't accept media in a tool result.
   */
  contentParts?: Array<TextContent | ImageContent | FileContent>
  details?: TDetails
  isError?: boolean
  error?: ToolErrorPayload
  /** If true, agent stops after this tool batch */
  terminate?: boolean
  /**
   * Marks this result as a SNAPSHOT of a live, mutating resource keyed by this
   * string (e.g. a preview page, a terminal screen). Only the latest result of a key is
   * valid, so at the next context checkpoint the older ones are replaced by a recovery
   * pointer in the model context (`context/checkpoint/transforms.ts`) — at a checkpoint and
   * not before, because collapsing on arrival would rewrite a message already sent.
   * Per-resource (two terminals → two keys). The persisted history is untouched. The
   * live-execution hook `afterToolCall` also reads it, to keep stale frames out of the
   * searchable context store.
   */
  supersedeKey?: string
  /**
   * Per-CALL override of the tool's static {@link AgentTool.mutates} flag, for a tool
   * whose calls are sometimes read-only. `bash` is the only one that matters: it is
   * statically `mutates: true` (it can `rm -rf`), but `rg`/`git diff`/`ls` change
   * nothing — and treating those as mutations resets the exploration-guard streak, so
   * a model that researches exclusively through the shell is never braked. A tool that
   * can classify its own call sets this; everything else leaves it undefined and keeps
   * the static flag — except that a result with `isError` counts as non-mutating no
   * matter what the static flag says, because a call that failed changed nothing. A tool
   * that DID mutate before failing (a partial write) sets `mutated: true` explicitly.
   */
  mutated?: boolean
  /**
   * Display-only permission provenance for this call. A tool that re-enters the run's
   * permission gate itself sets it, and the inner, more specific decision wins over the
   * loop-level gate's (usually default-allow, hence absent) provenance. Rides the
   * `tool_execution_end` event onto the tool item. Never sent on the model wire.
   */
  gateProvenance?: ToolGateProvenance
}

/** A single action a running tool exposes to the UI. */
export interface ToolAction {
  /** Short label shown in UI (e.g. "Kill", "Pause"). */
  label: string
  /** Lucide icon name for the button (e.g. "square", "pause"). */
  icon?: string
  /** Whether this action is currently available. */
  enabled?: boolean
  /** Visual emphasis only; authorization remains entirely server-side. */
  tone?: 'neutral' | 'danger'
  execute(payload?: unknown): void
}

/** Safe, serializable projection of a registered {@link ToolAction}. */
export interface ToolActionDescriptor {
  /** Tool call that owns and authorizes the action. */
  toolCallId: string
  /** Registry key passed back to `interact` (for example `kill` or `pause`). */
  action: string
  label: string
  icon?: string
  enabled?: boolean
  tone?: 'neutral' | 'danger'
}

/** Declarative transcript treatment owned by the tool descriptor. */
export interface AgentToolPresentation {
  /**
   * `content` renders a returned rich UI as first-class assistant content, with
   * no generic tool header/disclosure around it. The default `tool` treatment
   * retains ordinary tool chrome. `hidden` suppresses routine protocol activity, not failures
   * or other items in the message. This is presentation only: persistence and model history
   * retain the item. Kept as an object so surfaces can add independent policies.
   */
  transcript?: 'tool' | 'content' | 'hidden'
}

/**
 * Registry passed to tools that need to outlive their execute() call.
 *
 * Tools register named actions (kill, pause, send_input, …) that the UI
 * can surface as buttons. New action types can be added without changing
 * the tool or runner interfaces.
 */
export interface AsyncToolRegistry {
  /**
   * Register one or more live actions for this toolCallId.
   * Returns an unregister callback — call it when the tool finishes.
   *
   * @example
   * const unregister = context.asyncRegistry?.registerActions(toolCallId, {
   *   kill: { label: 'Kill', icon: 'square', execute: () => proc.kill() },
   * })
   */
  registerActions(
    toolCallId: string,
    actions: Record<string, ToolAction>,
    options?: {
      /**
       * How the job should be NAMED wherever jobs are listed — the prompt's background-job
       * section, the `jobs` tool, the status strip.
       *
       * Supplied by the registrant because only it knows: the host can guess a shell
       * command from the call's `command` argument, and for anything else it guessed
       * "background job". A tool that outlives its call for its own reasons — a data
       * stream, a call promoted for outrunning its budget — has to say what it is.
       */
      label?: string
      /**
       * The model-facing job id, when the registrant ALREADY has one the agent has been told
       * about. Normally the host allocates it (`bg-1`, `bg-2`), which is right for a process
       * whose only identity is this call. A monitor is the other case: the wake that reaches
       * the agent names it (`mon-1`) before `jobs` is ever consulted, so the host adopting a
       * different id would print an id in the wake that `jobs action="stop"` cannot resolve.
       * Such an id comes from the host's own allocator, so it is always one the host issued.
       */
      jobId?: string
      /**
       * What kind of background work this is, when it is not a plain process: a `monitor`
       * (a watch the host polls) or a call `promoted` for outrunning its budget. The host lists,
       * ids and ends every kind the same way; the kind is what a listing shows the reader.
       */
      kind?: 'monitor' | 'promoted'
    },
  ): () => void

  /** Get currently registered actions for a toolCallId. */
  getActions(toolCallId: string): Record<string, ToolAction> | undefined

  /**
   * Return the short, model-facing job id for a background tool call when the
   * host tracks one. Tools should still tolerate undefined and fall back to the
   * original toolCallId in non-hosted contexts.
   */
  getBackgroundJobId?(toolCallId: string): string | undefined

  /** Associate a host PTY with a registered background job without emitting an
   * output update. Used so later send_input activity carries the exact terminal
   * identity even when the process has not printed anything yet. */
  setBackgroundJobTerminalId?(toolCallId: string, terminalId: string): void

  /**
   * Emit a streaming output update for a background process.
   * Call with done=true on the final update to persist the final state.
   */
  emitBackground(
    toolCallId: string,
    output: string,
    opts?: {
      exitCode?: number
      wallTimeMs?: number
      done?: boolean
      jobStatus?: string
      details?: Record<string, unknown>
      /** When true on the final update, "wake" the owning session with the result. */
      notify?: boolean
    },
  ): void

  /**
   * How many background jobs the owning session currently has RUNNING, derived from
   * the host's live job records — never a second counter that could drift from them.
   *
   * A tool asks before starting one more. Jobs can be started far faster than they
   * finish (a promoted timeout starts one without the model even asking), so a
   * caller that never checks can exhaust process-local resources on one session.
   * Absent (non-hosted contexts, tests) means "unbounded" — the check is the
   * caller's to skip, not the host's to fake.
   */
  countBackgroundJobs?(): number

  /**
   * Abort the entire agent session.
   * Call this from a foreground tool's kill handler so the agent stops
   * immediately instead of continuing after the tool returns.
   */
  abortSession?(): void
}

/**
 * Generic per-session host capability handed to every tool's execution context.
 * Deliberately app/UI-agnostic: it carries the session id, a session-scoped
 * scratch directory any tool may use, and a generic live-data channel to a client
 * renderer. This is the growth point that lets feature tools (e.g. the bundled
 * extension-owned renderers live OUTSIDE core without the host hardcoding their concepts —
 * the host wires it once; plugins consume it. Optional; tools tolerate its absence.
 */
export interface ToolSessionContext {
  /** The current session id. */
  id: string
  /** A session-scoped scratch directory a tool may write/read (host-writable). */
  scratchDir: string
  /**
   * The agent this run speaks as, bound by the host.
   *
   * A tool that records WHO did something — a board card taken, a claim made — must not take the
   * actor from its input, where a model could name any agent. The host knows which participant's
   * turn it is; it stamps that here. Absent when the run has no addressable speaker.
   */
  speaker?: {
    /** The stable registry identity. */
    agentId: string
    /** The name the conversation addresses it by, without `@`. */
    handle: string
  }
  /**
   * Publish ONE plugin→UI command as a typed, REPLAYABLE session-stream frame. The host
   * wraps it into its stream envelope keyed by `plugin` + `channel`; the plugin's
   * UI registers a matching sink (a per-plugin command registry) on the client.
   * Non-coalescing: every call is delivered in order, and a reconnecting client
   * replays missed commands (deduped client-side by the envelope's command id).
   * Optional — hosts without a command stream omit it, and tools must say so
   * honestly instead of pretending the command landed.
   */
  emitCommand?(plugin: string, channel: string, payload: unknown): void
  /**
   * The round-trip variant of {@link emitCommand}: publish the command AND await
   * the client sink's reply, correlated server-side by the frame's `commandId`
   * (mirroring the `browser` tool's probe relay). The promise always settles —
   * never rejects: no client answering within the timeout resolves
   * `{ ok: false, noReply: true }`, so a tool can report "the UI didn't answer"
   * honestly instead of crashing. Optional and narrower than it looks: only hosts
   * with a client→server reply RPC wire it; tools must tolerate its absence.
   */
  emitCommandWithReply?(
    plugin: string,
    channel: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<ToolCommandReplyOutcome>
}

/**
 * How a {@link ToolSessionContext.emitCommandWithReply} round-trip ended. `result`
 * is opaque to core — the plugin's two ends share its shape (same idiom as the
 * command payload). `noReply` distinguishes "no client answered" (tab closed /
 * client offline — not a defect) from an explicit failure the sink reported.
 */
export type ToolCommandReplyOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string; noReply?: boolean }

export interface AgentToolExecutionContext {
  humanInLoop?: HumanInLoopController
  /** Available when agent-runner supports kill / background-process tracking. */
  asyncRegistry?: AsyncToolRegistry
  /**
   * Host-owned final boundary for sensitive tool output. Applied after execute and
   * before the result is cached, streamed or returned to the model.
   */
  sanitizeResult?: (result: AgentToolResult) => AgentToolResult
  /** Same boundary for a tool that throws instead of returning an error result. */
  sanitizeError?: (error: unknown) => unknown
  /**
   * Same boundary for anything a tool SHOWS rather than returns — a nested agent's tool arguments,
   * a progress detail. Applied before the value is recorded, streamed or persisted, never before
   * execute: redacting what runs would break the command.
   *
   * A host that renders a CHILD agent's activity needs this: those inputs come from another process
   * and land in the parent's transcript, where `sanitizeResult` never sees them.
   */
  sanitizeInput?: (value: unknown) => unknown
  /**
   * Whether a prompt raised through {@link humanInLoop} would actually reach a human
   * on this run's surface, when the host wires it through. A tool that must PAUSE on a
   * user-facing overlay reads this to fail fast with an actionable result instead of
   * blocking on a prompt nobody will answer (or dying when the host refuses to surface
   * it). Distinct from {@link AgentTool.interactiveOnly}, which removes a whole tool
   * from non-interactive runs: this lets a MIXED tool keep the actions that need no
   * human and decline only the ones that do.
   *
   * Generic and optional; tools must tolerate it being absent, and absent means
   * "assume reachable" so a host that does not wire it keeps its current behaviour.
   */
  interactive?: boolean
  /** Generic per-session host capability (id + scratch dir + live-data channel); see {@link ToolSessionContext}. */
  session?: ToolSessionContext
}

/**
 * UI category used to group tools in settings.
 * The api tool manifest tags each tool with one of these; the frontend reads them from the API.
 * Add new categories here as needed.
 */
export type AgentToolCategory = 'core' | 'filesystem' | 'knowledge' | 'automation' | 'ui'

// ---- Tool guards ---------------------------------------------------------------

/**
 * A guard's decision (NestJS-guard-like): `undefined` = allow the call; `{ block:
 * true, result }` = deny it and hand `result` back to the model as the tool's
 * result. Deliberately POLICY-FREE — @localixai/agent provides only the mechanism +
 * the two evaluation points (see {@link AgentTool.guard} / {@link AgentTool.streamGuard});
 * concrete guards live in the host (apps/api) and attach to a tool definition.
 */
export type GuardVerdict<TDetails = unknown> =
  | { block: true; result: AgentToolResult<TDetails> }
  | undefined

/** Context for a tool's PRE-EXECUTE guard (after Zod validation, before execute). */
export interface ToolGuardContext<TInput = unknown> {
  toolCallId: string
  /** The validated tool input. */
  input: TInput
  /** The run's abort signal, when the host wires it through. */
  signal?: AbortSignal
}

/**
 * STREAMING early guard. The agent loop evaluates it DURING generation, the moment
 * every `requiredFields` key is present (and terminated) in the partially-parsed
 * tool-call JSON — so a call that is already doomed (e.g. a blind overwrite of an
 * unread file) can be aborted BEFORE its large body finishes streaming, saving the
 * wasted output tokens. `evaluate` receives only the fields streamed so far.
 *
 * Keep it fast and side-effect-light: it runs on the hot streaming path. When it
 * blocks, the loop aborts ONLY the provider stream (an internal controller, never
 * the user signal) and synthesizes the tool result from the verdict, so the model
 * sees exactly the denial it would get from the pre-execute {@link AgentTool.guard}.
 * Always pair a streamGuard with a pre-execute `guard` carrying the SAME logic — it
 * is the backstop for calls that finish streaming before the guard can fire.
 */
export interface ToolStreamGuard<TDetails = unknown> {
  /** Top-level arg keys needed to decide (e.g. ['path']). Put them FIRST in the schema. */
  requiredFields: string[]
  evaluate(
    partialInput: Record<string, unknown>,
  ): Promise<GuardVerdict<TDetails>> | GuardVerdict<TDetails>
}

/**
 * Advisory behavior metadata supplied by an external tool descriptor. These
 * hints are useful for permission UX and diagnostics, but are not an authority:
 * the host's effective permission classification remains {@link AgentTool.mutates}.
 */
export interface AgentToolBehaviorHints {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface AgentTool<TInput = unknown, TDetails = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  /**
   * Rewrite raw model arguments into the schema's shape BEFORE they are validated.
   *
   * The runtime validates against the JSON form of `inputSchema` and never parses the zod
   * schema itself, so a `z.preprocess` step does not run on the dispatch path. A tool whose
   * schema recovers a known-meaning shape (an alias, a recorded model mistake) declares that
   * rewrite here too, or the model is refused for a call the tool would have understood. Must
   * return its input unchanged when it recognises nothing.
   *
   * It may THROW to refuse a shape in better words than the validator's: the runtime turns the
   * message into the call's error result (`browser` names the `steps` call that
   * replaces a retired flat interaction this way).
   */
  prepareArguments?: (raw: unknown) => unknown
  /**
   * Runtime-surface capabilities this tool needs in order to be useful and
   * executable. The assembly boundary applies this ONE declaration to model
   * schemas and runtime dispatch; callers must not maintain name-based UI-only
   * deny lists.
   *
   * Omit for surface-agnostic tools. A workbench/desktop-only tool declares the
   * host capability it consumes (for example `workbench-ui`) at its registration
   * source, including plugin-owned tools unknown to core.
   */
  availability?: ToolAvailability
  /**
   * Input modalities the MODEL must read for this tool to be worth offering (`['image']` for a
   * tool whose whole output is a picture). The ledger's `model` layer withholds the tool from a
   * run whose model cannot read them — a text-only model handed `view_image` spends a turn on a
   * result it is then told it cannot see. Declared here, on the tool, so a plugin or MCP tool
   * states it the same way a built-in does.
   */
  requiresModelInput?: readonly string[]
  /**
   * The variant of this tool for a model that reads `modelInput`. For a tool with only SOME
   * model-dependent actions — `browser`'s `take_screenshot` — withholding the whole tool is too
   * much and offering the action is wrong, so the tool returns itself without that part. Called
   * once per run on a LIVE tool; omit when nothing depends on the model.
   */
  forModel?: (modelInput: readonly string[]) => AgentTool<TInput, TDetails>
  /** Human-readable label shown in UI (defaults to name) */
  label?: string
  /** How this tool executes relative to others in the same batch */
  executionMode?: 'sequential' | 'parallel'
  /**
   * For parallel-eligible tools that touch the filesystem, return the paths this
   * call reads or writes (given the raw, unvalidated tool input). The agent loop
   * uses these to serialize calls whose paths overlap — so two concurrent calls
   * never race on the same file (or a file under the same directory) — while still
   * running independent-path calls concurrently. Return [] (or omit the function)
   * for tools with no single file scope (e.g. project-wide search). Pure read-only
   * tools may omit this; it matters once a mutating tool opts into parallel.
   */
  parallelScopePaths?: (input: unknown) => string[]
  /**
   * True if this tool mutates external state (files, processes, persisted data).
   * Upper layers use it for permission gating: a rule that confirms mutations asks
   * before a mutating tool runs. Read-only tools omit it.
   */
  mutates?: boolean
  /**
   * Classify ONE call, BEFORE it runs: what it reaches, whether it can be undone, and
   * whether it needs a person. See {@link CallClass}.
   *
   * `mutates` is static, and for a dual-purpose tool that is the whole problem: a
   * `SELECT` and a `DROP TABLE` arrive through the same tool, as do `GET` and `DELETE`.
   * A yes/no answer per call was the first fix and was still not enough: a read-only
   * session must refuse a `DROP TABLE` yet let a board card or a game move through, and an
   * unattended session must refuse `vault create` yet keep `vault list`. Both questions are
   * about the CALL, so the call answers them.
   *
   * `mutated` on the RESULT cannot help: it is read after execution, to feed the
   * exploration guard and the context store. This is the pre-execution half.
   *
   * Must be pure and synchronous — it runs on the permission path, before the gate
   * decides. It cannot look anything up (no connection, no filesystem), so a classifier
   * that needs context it does not have must answer the WIDER effect: the conservative
   * answer is the safe one. Absent → {@link classifyByFlag} answers from `mutates`, and a tool
   * that declares neither is treated as `external` — an undeclared tool is an unknown one.
   */
  classify?: (input: unknown) => CallClass
  /**
   * The filesystem paths THIS call would touch, for the permission engine to judge.
   *
   * The host derives these facts from a switch over tool NAMES, which by construction can only know
   * about its own built-ins. A tool it does not recognise produced NO paths — and no paths means
   * `outsideWorkspace: false`, so the default `mutates + outside-workspace → ask` rule cannot fire
   * and a user's own path `pattern` rule has nothing to match. A plugin tool that writes files was
   * therefore able to write anywhere on disk with no prompt. Declaring targets here is how a tool
   * the host has never heard of becomes visible to the rules that already exist.
   *
   * Return every path the call could write or delete, absolute or relative (the host resolves them
   * against the session cwd/root exactly as it does for its own tools). Declare the DIRECTORY too
   * when the effect fans out beyond the named file. A read-only tool needs nothing here.
   *
   * Must be pure and synchronous — it runs on the permission path, before the gate decides — and
   * conservative: when the target cannot be predicted, return the widest path the call could touch,
   * because an undeclared path is an unguarded one. The host ignores a throw or a non-array result
   * (a plugin bug must not break the gate) and its own facts always win for a tool it does handle,
   * so this can widen what the rules see but never narrow it.
   */
  permissionPaths?: (input: unknown) => string[]
  /**
   * Native policy resources touched by this call, such as an operation or record key.
   * Pure and synchronous, like permissionPaths. Declare every resource the call can affect;
   * an allow exception must cover them all. These add to filesystem/command facts, never
   * replace them. Invalid declarations fail the permission check rather than hiding targets.
   */
  permissionResources?: (input: unknown) => readonly string[]
  /** Advisory external behavior metadata retained alongside the effective `mutates` flag. */
  behaviorHints?: AgentToolBehaviorHints
  /**
   * True if this tool runs as a long-running BACKGROUND job — it returns while a
   * process keeps producing output and is stoppable from the runtime panel. The
   * host uses this generically (instead of hardcoding tool names) to register a
   * background child session + a stop action. Foreground tools omit it.
   */
  background?: boolean
  /**
   * Budget after which a still-running call is moved to the BACKGROUND instead of being
   * failed or waited out. Absent means the call has no such budget and runs to completion.
   *
   * Opt-in per tool, and it must be: promotion only makes sense where "keep going and tell
   * me later" is a truthful thing to say about the work. It is meaningless for a file read,
   * and wrong for a tool whose whole result is the thing the model is waiting on.
   *
   * The body is NEVER abandoned. Promotion hands the in-flight promise to a settler that
   * delivers through the background-job channel when it lands — a `Promise.race` would
   * report completion while the work continued and throw its result away.
   */
  promoteAfterMs?: number
  /**
   * Optional VBC context-class hint. The host registers this generically (instead
   * of hardcoding tool names in core — same idiom as {@link background}) so context
   * compression treats the tool right: 'readResult' = result is a recoverable
   * observation (elided near-losslessly); 'mutate' / 'patch' = single-arg / patch-body
   * writer; 'nonidempotent' = side effect that never supersedes. Lets extension tools
   * classify themselves without core knowing their names.
   * Omit for plain foreground tools.
   */
  contextClass?: 'readResult' | 'mutate' | 'patch' | 'nonidempotent'
  /**
   * Which run SHAPES may carry this tool — declared by the tool, read by the host's ledger.
   *
   * Replaces the boolean `interactiveOnly` (chat-or-not) and the host's central per-shape
   * allowlists: a tool that renders into the user's chat says `subagent: 'never'`, a tool a
   * focused child may opt into says `'opt-in'`. Omit for the plugin default
   * ({@link DEFAULT_TOOL_EXPOSURE}): on the wire in a chat, declarable elsewhere.
   */
  exposure?: ToolExposure
  /** Keep this tool call outside collapsed chains because it owns live/interactive UI. */
  standalone?: boolean
  /** Tool-owned transcript/UI treatment; the host never branches on the tool name. */
  presentation?: AgentToolPresentation
  /**
   * This tool reveals additional dispatch tools to the model. Its successful result must carry
   * `details.activated: string[]`; runtime adapters append those tools' full schemas before the
   * next model turn. The host still validates every name against the dispatch registry.
   */
  activatesTools?: boolean
  /** Verb or action phrase shown in the UI during execution (e.g. 'Reading', 'Writing') */
  activeVerb: string
  /**
   * PRE-EXECUTE guard: runs after input validation, before {@link execute}.
   * Returning a
   * blocking verdict short-circuits the call — the loop emits the normal
   * start→error→end events with the verdict's result and never calls execute().
   * Keeps a tool's own refusal logic inside the tool (single source of truth)
   * instead of an external hook. See {@link GuardVerdict}.
   */
  guard?(ctx: ToolGuardContext<TInput>): GuardVerdict<TDetails> | Promise<GuardVerdict<TDetails>>
  /**
   * STREAMING early guard — the same decision as {@link guard}, evaluated mid-stream
   * to abort a doomed call before its body finishes generating (saves output tokens).
   * A tool that sets this should ALSO set {@link guard} with identical logic as the
   * backstop. See {@link ToolStreamGuard}.
   */
  streamGuard?: ToolStreamGuard<TDetails>
  // METHOD SHORTHAND, deliberately — do NOT rewrite as `execute: (...) => ...`. The bivariant
  // parameter checking a method signature gets is load-bearing here: tool registries hold
  // `AgentTool<unknown>`, and a concrete `AgentTool<{ action: ... }>` is only assignable into
  // one because the method form checks `input` bivariantly. A function-typed property is
  // contravariant and breaks that assignment across the whole tool-registration surface.
  execute(
    toolCallId: string,
    input: TInput,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    context?: AgentToolExecutionContext,
  ): Promise<AgentToolResult<TDetails>>
}

/** Capabilities exposed by the client/runtime surface assembling a tool set. */
export interface ToolSurface {
  capabilities: readonly string[]
  /**
   * Optional immutable catalog ids bound to individual capabilities. The host
   * validates each id before use; they grant no authority by themselves.
   */
  catalogs?: Readonly<Record<string, string>>
}

/** Declarative availability policy carried by the tool descriptor itself. */
export interface ToolAvailability {
  requiredCapabilities: readonly string[]
}

export { DEFAULT_TOOL_EXPOSURE } from './tool-exposure'
export type { RunShape, ExposureLevel, ToolExposure } from './tool-exposure'

// ---- Agent events --------------------------------------------------------------

/**
 * Provider-independent source metadata attached to a streamed assistant part.
 *
 * A delta must be useful without a cumulative message snapshot: runtime adapters
 * can therefore pass only the changed part across the hot path while the host
 * preserves provider signatures and progressive tool-call metadata.
 */
export interface AgentMessageOrigin {
  api?: string
  provider?: string
  model: string
}

export type { AgentStopReason, AgentMessageDelta, AgentEvent } from './event-types'

export interface BeforeToolCallContext {
  toolCallId: string
  toolName: string
  input: unknown
  /** Optional human-readable source for nested tool calls, e.g. a delegate title. */
  sourceTitle?: string
}
/**
 * How a gated tool call was ALLOWED — the permission gate's decision provenance,
 * carried onto the tool item so the UI can explain "why did this run without
 * asking?". Only non-default outcomes are recorded (a plain default-allow with
 * no matching rule stays undefined — badging every call would be noise).
 */
export interface ToolGateProvenance {
  /**
   * - `user-approved` — a human approved THIS call via the confirm prompt.
   * - `session-grant` — auto-approved by an earlier session-wide "Always allow".
   * - `rule-allow` — an explicit allow rule matched (skill allowed-tools /
   *   project or mode permission rule).
   */
  decision: 'user-approved' | 'session-grant' | 'rule-allow'
  /** Human-readable source, e.g. the matched rule (`bash(git *)`). */
  detail?: string
}

/** The gate's verdict lives beside this file (`gate-verdict.ts`). */
export type { BeforeToolCallResult } from './gate-verdict'

// NB: neither hook context carries the conversation `messages`. It used to — and the
// pi adapter paid a FULL history conversion per tool call, twice, for a field no
// consumer (permission gate, externalizer, plugin hooks) ever read. A hook that one
// day needs history should get a lazy accessor, not a pre-built copy.
export interface AfterToolCallContext {
  toolCallId: string
  toolName: string
  input: unknown
  result: AgentToolResult
}
export interface AfterToolCallResult {
  content?: string
  isError?: boolean
  terminate?: boolean
}
