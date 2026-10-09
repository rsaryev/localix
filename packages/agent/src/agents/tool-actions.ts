/** Live tool actions and the host registry that tracks background work. */

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
