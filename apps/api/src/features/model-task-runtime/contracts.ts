/** Provider-neutral description of one bounded model operation. */
export interface ModelTaskRequest<Input> {
  task: {
    /** Stable recipe identifier, such as `session-title`. */
    id: string
    /** Increment whenever the recipe's semantic contract changes. */
    version: number
  }
  system: string
  input: Input
  /**
   * The task's own token ceilings, forwarded verbatim to the executor. The runtime
   * ENFORCES NEITHER: it owns cancellation, the deadline, and the typed outcome, and
   * has no tokenizer with which to measure a prompt. A task that needs its input
   * bounded must bound it where the content is assembled, and derive these numbers
   * from those same limits so the declaration cannot drift from what is actually sent.
   */
  budget: {
    inputTokens: number
    outputTokens: number
  }
  capabilities: {
    structuredOutput?: boolean
    streaming?: boolean
    promptCaching?: boolean
  }
  /** Caller cancellation; never infer cancellation from a provider error. */
  signal?: AbortSignal
  /** Host-owned wall-clock deadline in Unix milliseconds. */
  deadlineAtMs?: number
}

/** Normalized adapter response. Task-specific parsing deliberately stays outside the runtime. */
export interface ModelTaskResponse<Output> {
  output: Output
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  finishReason?: string
  retryable?: boolean
}

/** The only provider-specific boundary required by the shared runtime. */
export type ModelTaskExecutor<Input, Output> = (
  request: Omit<ModelTaskRequest<Input>, 'signal'>,
  signal: AbortSignal,
) => Promise<ModelTaskResponse<Output>>

export type ModelTaskOutcome<Output> =
  | { status: 'success'; response: ModelTaskResponse<Output> }
  | { status: 'cancelled' }
  | { status: 'deadline_exceeded' }
  | { status: 'provider_error' }

export interface ExecuteModelTaskOptions<Input, Output> {
  request: ModelTaskRequest<Input>
  execute: ModelTaskExecutor<Input, Output>
}
