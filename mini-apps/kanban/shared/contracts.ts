import { z } from 'zod'

/**
 * The board's wire and storage contract, read by the backend, the tool and the view alike.
 *
 * A board belongs to ONE chat session and lives in that session's mini app folder, so the host
 * deletes it with the chat. The board is passive: it records workflow state and reusable task
 * context and never starts a model, an agent or a session.
 *
 * Every type here is DERIVED FROM ITS SCHEMA. `subtasks`, `labels` and `artifacts` are replaced
 * wholesale on write, and a `z.object` strips unknown keys — so a field added to a hand-written
 * type but not to its schema would be silently destroyed on the next checkbox toggle. Deriving
 * the type from the validator makes that drift unrepresentable.
 */

export const KANBAN_STATUSES = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const
export const kanbanStatusSchema = z.enum(KANBAN_STATUSES)
export type KanbanStatus = z.infer<typeof kanbanStatusSchema>

/** 'epic' = a container; 'task' = a unit someone can explicitly take. */
export const KANBAN_KINDS = ['epic', 'task'] as const
export const kanbanKindSchema = z.enum(KANBAN_KINDS)
export type KanbanKind = z.infer<typeof kanbanKindSchema>

/** Who created a card: the board's routes write `user`, the agent's tool writes `agent`. */
export const KANBAN_ORIGINS = ['user', 'agent'] as const
export const kanbanOriginSchema = z.enum(KANBAN_ORIGINS)
export type KanbanOrigin = z.infer<typeof kanbanOriginSchema>

/** How many labels one card may carry, and how long a name may be — the view enforces them too. */
export const KANBAN_MAX_LABELS = 8
export const KANBAN_LABEL_MAX_LENGTH = 24

export const kanbanSubtaskSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  done: z.boolean(),
})
export type KanbanSubtask = z.infer<typeof kanbanSubtaskSchema>

/** A structured deliverable. Consumers fall back to showing `value` for a kind they do not know. */
export const KANBAN_ARTIFACT_KINDS = ['file', 'url', 'command', 'note'] as const
export const kanbanArtifactKindSchema = z.enum(KANBAN_ARTIFACT_KINDS)
export type KanbanArtifactKind = z.infer<typeof kanbanArtifactKindSchema>

export const kanbanArtifactSchema = z.object({
  kind: kanbanArtifactKindSchema,
  value: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
})
export type KanbanArtifact = z.infer<typeof kanbanArtifactSchema>

/** One label name, trimmed and lower-cased so `Flaky`, `flaky ` and `flaky` are one label. */
export const kanbanLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(KANBAN_LABEL_MAX_LENGTH)
  .transform((value) => value.toLowerCase())

const priority = z.number().int().min(-2).max(2)
const dependsOn = z.array(z.string()).max(20)
const attachedPaths = z.array(z.string().min(1).max(1024)).max(20)
const labels = z.array(kanbanLabelSchema).max(KANBAN_MAX_LABELS)
const subtasks = z.array(kanbanSubtaskSchema).max(50)

export const kanbanTaskSchema = z.object({
  /** `LX-<seq>`: short, token-cheap, and unique within its board. */
  id: z.string().min(1),
  seq: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(8000),
  status: kanbanStatusSchema,
  kind: kanbanKindSchema,
  /** The epic this task belongs to; null for an epic or a top-level task. */
  parentTaskId: z.string().nullable(),
  /** Stable registry identity of the assigned agent, and its name for display. */
  agentId: z.string().nullable(),
  assignee: z.string().nullable(),
  /** Why the card is blocked. */
  error: z.string().nullable(),
  /** Cards this one waits for; taking it requires every one of them `done`. */
  dependsOn,
  /** Workspace paths attached as task context. */
  attachedPaths,
  /** Free-form label names; a colour is derived from each name. */
  labels,
  /** Display priority within a column (higher first). */
  priority,
  artifacts: z.array(kanbanArtifactSchema),
  /** The card's leaf-level work plan. */
  subtasks,
  origin: kanbanOriginSchema,
  sortOrder: z.number(),
  createdAt: z.string(),
  /** Millisecond ISO time, also the optimistic edit token: two writes never share it. */
  updatedAt: z.string(),
})
export type KanbanTask = z.infer<typeof kanbanTaskSchema>

/** One session's board, as stored. `nextSeq` never goes back, so a deleted id is never reused. */
export const kanbanBoardSchema = z.object({
  version: z.literal(1),
  nextSeq: z.number().int().positive(),
  tasks: z.array(kanbanTaskSchema),
})
export type KanbanBoard = z.infer<typeof kanbanBoardSchema>

export const EMPTY_BOARD: KanbanBoard = { version: 1, nextSeq: 1, tasks: [] }

/** Render a card's reference, e.g. `LX-42` — also its id. */
export const taskRef = (seq: number): string => `LX-${seq}`

export const createKanbanTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).optional(),
  status: kanbanStatusSchema.optional(),
  kind: kanbanKindSchema.optional(),
  parentTaskId: z.string().nullable().optional(),
  /** Agent id or name; resolved against the agent registry. */
  agent: z.string().trim().min(1).nullable().optional(),
  dependsOn: dependsOn.optional(),
  attachedPaths: attachedPaths.optional(),
  labels: labels.optional(),
  priority: priority.optional(),
  subtasks: subtasks.optional(),
})
/** What a caller hands in (`z.input`: defaults and transforms have not run yet). */
export type CreateKanbanTaskRequest = z.input<typeof createKanbanTaskSchema>

export const updateKanbanTaskSchema = z.object({
  /** The `updatedAt` the editor last saw; a newer card rejects the write as stale. */
  expectedUpdatedAt: z.string().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  status: kanbanStatusSchema.optional(),
  parentTaskId: z.string().nullable().optional(),
  agent: z.string().trim().min(1).nullable().optional(),
  error: z.string().nullable().optional(),
  dependsOn: dependsOn.optional(),
  attachedPaths: attachedPaths.optional(),
  labels: labels.optional(),
  priority: priority.optional(),
  sortOrder: z.number().optional(),
  subtasks: subtasks.optional(),
  artifacts: z.array(kanbanArtifactSchema).max(50).optional(),
})
export type UpdateKanbanTaskRequest = z.input<typeof updateKanbanTaskSchema>

/**
 * One drag: a card's new column, its place in it, and its epic when the drop changed it.
 * Deliberately narrower than a patch — a batch endpoint that took arbitrary edits would be a
 * second, unaudited write path for everything else on a card.
 */
export const kanbanMoveSchema = z.object({
  id: z.string().min(1),
  status: kanbanStatusSchema,
  sortOrder: z.number(),
  parentTaskId: z.string().nullable().optional(),
})
export type KanbanMove = z.infer<typeof kanbanMoveSchema>

/** A drag of N cards lands together or not at all. */
export const kanbanMovesSchema = z.object({ moves: z.array(kanbanMoveSchema).min(1).max(200) })

/** What changed on a board, pushed to every view of it. */
export type BoardEvent =
  | { type: 'task.created'; sessionId: string; task: KanbanTask }
  | { type: 'task.updated'; sessionId: string; task: KanbanTask }
  | { type: 'task.deleted'; sessionId: string; taskId: string }
