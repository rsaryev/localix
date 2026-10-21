/**
 * Model assignment roles shared by every client surface.
 *
 * `session` is the required default chat model. Every other workload persists
 * one uniform record under `agentSettings.modelRouting`; when its assignment is
 * absent it falls back to the session model (or its own feature default).
 *
 * This module is dependency-free so it is safe to import from a browser bundle.
 */

interface ModelTaskDescriptor {
  /** Short label for the task list. */
  label: string
  /** One-line hint shown under the label. */
  hint: string
  /** Copy shown when the route has no explicit model assignment. */
  fallbackLabel?: string
  /** Whether the consumer itself can be disabled from the route picker. */
  toggleable?: boolean
  /** Behaviour before the user stores an explicit on/off choice. */
  defaultEnabled?: boolean
}

/**
 * Auxiliary slots offered by the model picker. This literal catalog owns the
 * key union too, so adding a row cannot leave a picker's types behind.
 */
export const AUX_MODEL_TASKS = [
  {
    key: 'titleGeneration',
    label: 'Session titles',
    hint: 'Names new chats',
    fallbackLabel: 'Use simple title',
    toggleable: true,
  },
  {
    key: 'inlineCompletion',
    label: 'Inline completion',
    hint: 'Completes code and text inputs',
    fallbackLabel: 'Use session model',
    toggleable: true,
    defaultEnabled: false,
  },
] as const satisfies readonly ({ key: string } & ModelTaskDescriptor)[]

/**
 * DELEGATED RUNS HAVE NO ROUTE PER AGENT, on purpose.
 *
 * There used to be a "Delegated task runs" group here: one route per shipped agent plus a
 * default and a reviewer — a third copy of the agent roster, and a second home for a worker's
 * model. An agent's model is its RECORD's (`preferredModel`/`preferredProvider`/`preferredEffort`,
 * Settings → Agents), where it applies on every dispatch path; a delegated run whose agent names
 * no model inherits the delegating session, like every other unrouted workload.
 */

/** Auxiliary slots offered for selection — derived from the canonical catalog. */
export type AuxTaskKey = (typeof AUX_MODEL_TASKS)[number]['key']
/** Every assignable role: the required session model plus auxiliary workloads. */
export type ModelTaskKey = 'session' | AuxTaskKey
/** Every route shown by the rich model drawer. */
export type ModelRoutingTaskKey = ModelTaskKey

export interface ModelTask extends ModelTaskDescriptor {
  key: ModelTaskKey
  /** The session model is the only required pick; workload routes reuse it when unset. */
  required?: boolean
}

export interface ModelRoutingTask extends ModelTaskDescriptor {
  key: ModelRoutingTaskKey
  required?: boolean
}

export type AuxModelTask = (typeof AUX_MODEL_TASKS)[number]

export const MODEL_TASKS: ModelTask[] = [
  { key: 'session', label: 'Chat sessions', hint: 'Your default model', required: true },
  ...AUX_MODEL_TASKS,
]

/** Every route the rich drawer offers, in reading order. */
export const MODEL_ROUTING_TASKS: ModelRoutingTask[] = [...MODEL_TASKS]

export const isAuxTaskKey = (key: ModelRoutingTaskKey): key is AuxTaskKey =>
  AUX_MODEL_TASKS.some((task) => task.key === key)

export const isModelRoutingTaskKey = (value: string): value is ModelRoutingTaskKey =>
  MODEL_ROUTING_TASKS.some((task) => task.key === value)

type ModelRoutingSettings = { modelRouting?: Record<string, { enabled?: boolean }> }

/**
 * Every consumer uses the same settings path. Absence resolves through catalog
 * metadata: regular routes default on, while deliberately opt-in routes can
 * declare `defaultEnabled: false`.
 */
export const isModelRoutingTaskEnabled = (
  settings: ModelRoutingSettings | null | undefined,
  key: ModelRoutingTaskKey,
): boolean =>
  settings?.modelRouting?.[key]?.enabled ??
  MODEL_ROUTING_TASKS.find((task) => task.key === key)?.defaultEnabled ??
  true
