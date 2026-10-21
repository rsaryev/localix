import type { z } from 'zod'
import type { ToolExposure } from './tool-exposure'
import type { CallClass } from './call-class'
import type { AgentToolExecutionContext } from './tool-execution-context'
import type { AgentToolResult, AgentToolUpdateCallback } from './tool-result'
import type { GuardVerdict, ToolGuardContext, ToolStreamGuard } from './tool-guards'

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
  /**
   * Values only the calling model may read. Unlike `transcript`, this is not presentation: the named
   * input fields (and, with `result`, the result, details and error text) are replaced before the
   * item is persisted or streamed, so neither the user's client nor a later history rebuild ever
   * holds them. The model sees the real values for the rest of its run only; a tool that keeps a
   * secret across turns stores it itself and hands it back through a sealed result.
   */
  sealed?: AgentToolSealing
}

/** Which parts of a tool call {@link AgentToolPresentation.sealed} withholds. */
export interface AgentToolSealing {
  /** Top-level input keys replaced with {@link SEALED_PLACEHOLDER}. */
  input?: readonly string[]
  /** Also withhold the result text, details and error text. */
  result?: boolean
}

/** What a sealed value reads as everywhere outside the run that produced it. */
export const SEALED_PLACEHOLDER = '[sealed]'

/**
 * UI category used to group tools in settings.
 * The api tool manifest tags each tool with one of these; the frontend reads them from the API.
 * Add new categories here as needed.
 */
export type AgentToolCategory = 'core' | 'filesystem' | 'knowledge' | 'automation' | 'ui'

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
   * run whose model cannot read them — a text-only model handed a picture-only tool spends a
   * turn on a result it is then told it cannot see. Declared here, on the tool, so a plugin or MCP tool
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
  /**
   * How this tool's calls are scheduled within one assistant turn. `parallel` calls run
   * concurrently with each other (subject to {@link parallelScopePaths}); a `sequential` call
   * waits for every earlier call of the turn and finishes before any later call starts. It
   * does NOT serialize the rest of the turn. Defaults to `parallel` — except for a tool that
   * {@link mutates} and declares neither a mode nor {@link parallelScopePaths} (an unannotated
   * MCP tool): overlapping is opt-in for a writer, so such a call runs as if `sequential`.
   */
  executionMode?: 'sequential' | 'parallel'
  /**
   * Per-call override of {@link executionMode}, given the call's (validated) input. For a tool
   * whose read actions are safe to overlap but whose write actions are not — `memory` answers
   * `parallel` for `get`/`list` and `sequential` for `set`/`delete`. Must be pure and
   * synchronous; a throw schedules the call as `sequential`.
   */
  executionModeFor?: (input: unknown) => 'sequential' | 'parallel'
  /**
   * For parallel calls that touch the filesystem, return the paths this call reads or
   * writes (given the call's input). The scheduler orders calls whose paths overlap (the
   * same path, or one inside the other) when either is a writer ({@link mutates}), and runs
   * the rest concurrently. A parallel writer also waits for an earlier call that declares no
   * paths and holds back a later one, since that call's footprint is unknown; a parallel
   * writer that returns [] runs as if `sequential`. Return [] (or omit the function) for
   * tools with no single file scope (e.g. project-wide search).
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
   * It is the pre-execution answer: a result cannot help, it is read after the call ran.
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
