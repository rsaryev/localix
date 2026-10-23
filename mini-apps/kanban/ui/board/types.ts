import type { KanbanOrigin, KanbanStatus } from '../../shared/contracts'

export type OriginFilter = KanbanOrigin
export type BoardView = 'board' | 'stats'

export interface DropTarget {
  status: KanbanStatus
  /** Epic group the pointer is over; null = the column's loose area. */
  epicId: string | null
  /** Insertion index within that section (cards above the indicator). */
  index: number
}
