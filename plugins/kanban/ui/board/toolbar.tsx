import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'

import { KanbanCreateRow } from './toolbar-create-row'
import { KanbanFilterRow } from './toolbar-filter-row'
import type { BoardView } from './types'
import type { BoardQuickCreate } from './useBoardCreate'
import type { KanbanFilters } from './useKanbanFilters'

export function KanbanToolbar({
  view,
  onViewChange,
  quickCreate,
  onOpenFullCreate,
  filters,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  quickCreate: BoardQuickCreate
  /** Open the full task-creation form (description, dependencies, attachments…). */
  onOpenFullCreate: () => void
  filters: KanbanFilters
}) {
  return (
    <WorkbenchToolbar
      as="header"
      layout="stacked"
      aria-label="Kanban controls"
      className="@container"
    >
      <KanbanCreateRow
        draft={quickCreate.draft}
        setDraft={quickCreate.setDraft}
        busy={quickCreate.busy}
        onCreate={quickCreate.create}
        onOpenFullCreate={onOpenFullCreate}
      />
      <KanbanFilterRow view={view} onViewChange={onViewChange} filters={filters} />
    </WorkbenchToolbar>
  )
}
