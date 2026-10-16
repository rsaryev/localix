import type { PluginContext } from '@localixai/plugin-sdk/backend'

import type { KanbanTask } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import { boardUri } from '../shared/resource'
import { leadsBoard, type BoardSpeaker } from '../shared/rules'
import { slimTask, type KanbanToolDetails } from '../shared/tool'
import { resolveDependencies } from './describe'
import { resolveFor } from './member-view'
import type { BoardSeat, BoardService } from './service'
import { reviseChecklist, type ChecklistEntry } from './tool-input'

/** One card the `create` action puts on the board. */
export interface CreateEntry {
  title: string
  description?: string
  agent?: string
  kind?: 'epic' | 'task'
  parent?: string
  depends_on?: string[]
  priority?: number
  items?: ChecklistEntry[]
}

export type CreateInput = Omit<CreateEntry, 'title'> & {
  title?: string
  creates?: CreateEntry[]
}

type CreateResult = { content: string; details?: KanbanToolDetails }

/**
 * `create`: one card, or an ordered batch. A member's cards are the leader's to triage — they
 * land unassigned in backlog whatever owner the member named.
 */
export async function createCards(
  ctx: PluginContext,
  boards: BoardService,
  seat: BoardSeat,
  input: CreateInput,
  speaker?: BoardSpeaker,
): Promise<CreateResult> {
  const leads = leadsBoard(speaker)
  const entries = input.creates?.length ? input.creates : [{ ...input, title: input.title ?? '' }]
  const created: KanbanTask[] = []
  let refused: string | null = null
  for (const [index, entry] of entries.entries()) {
    try {
      if (!entry.title.trim())
        throw new BoardRefusal(400, 'title_required', 'create requires title.')
      if (entry.kind === 'epic' && entry.items?.length)
        throw new BoardRefusal(
          400,
          'epic_items',
          'An epic holds no checklist: its tasks are its checklist. Put the items on its tasks.',
        )
      const tasks = (await boards.read(seat)).tasks
      const parent = entry.parent ? resolveFor(tasks, speaker, entry.parent) : null
      created.push(
        await boards.create(
          seat,
          {
            title: entry.title,
            description: entry.description ?? '',
            kind: entry.kind ?? 'task',
            parentTaskId: parent?.id ?? null,
            // A member's new card is the leader's to triage: unassigned, in backlog.
            ...(entry.agent && leads ? { agent: entry.agent } : {}),
            ...(entry.depends_on
              ? {
                  dependsOn: leads
                    ? resolveDependencies(tasks, entry.depends_on)
                    : [
                        ...new Set(
                          entry.depends_on.map(
                            (raw) => resolveFor([...tasks, ...created], speaker, raw, created).id,
                          ),
                        ),
                      ],
                }
              : {}),
            ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
            ...(entry.items ? { subtasks: reviseChecklist([], entry.items) } : {}),
          },
          'agent',
        ),
      )
    } catch (error) {
      // The entries before this one are on the board already. Refusing the call whole reported
      // none of them, so the retry that fixed entry 3 created entries 1 and 2 a second time.
      // A refusal before anything was created is still the call's own failure.
      if (!(error instanceof BoardRefusal) || created.length === 0) throw error
      refused = `Entry ${index + 1} was not created: ${error.message} The entries above are on the board; do not create them again.`
      break
    }
  }
  return {
    content: [
      ...created.map((task) => `Created ${task.id} "${task.title}" in backlog.`),
      ...(!leads && created.length ? ['The leader will triage it: owner, place and status.'] : []),
      ...(refused ? [refused] : []),
    ].join('\n'),
    details: {
      sessionId: seat.sessionId,
      ...(created.length === 1 ? { task: created[0]! } : { tasks: created.map(slimTask) }),
      reveal: ctx.ui.offer({
        uri: boardUri(seat.sessionId),
        label: 'Open board',
        description: 'This chat’s board',
      }),
    },
  }
}
