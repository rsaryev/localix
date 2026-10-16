import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { userMoveTargets } from './utils'

/** One row of the card context menu, as data. */
export type CardMenuItem =
  | { kind: 'open' }
  | { kind: 'copy-ref' }
  | { kind: 'move'; to: KanbanStatus }
  | { kind: 'delete' }

/** The card context menu, top to bottom. */
export function cardMenuItems(task: KanbanTask): CardMenuItem[] {
  const targets = userMoveTargets(task)
  return [
    { kind: 'open' },
    { kind: 'copy-ref' },
    ...targets.map((to): CardMenuItem => ({ kind: 'move', to })),
    { kind: 'delete' },
  ]
}
