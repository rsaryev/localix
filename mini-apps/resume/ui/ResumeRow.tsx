import { FileText, MoreHorizontal } from 'lucide-react'
import {
  WorkbenchListRow,
  WorkbenchListRowTrigger,
  WorkbenchListRowLeading,
  WorkbenchListRowText,
  WorkbenchListRowMeta,
  WorkbenchListRowActions,
} from '@localixai/kit/workbench-list-row'
import { IconButton } from '@localixai/kit/icon-button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import type { ResumeSummary } from '../shared/schema'

export function ResumeRow({
  resume,
  onOpen,
  entries,
  disabled,
}: {
  resume: ResumeSummary
  onOpen: () => void
  entries: MenuEntry[]
  disabled: boolean
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <WorkbenchListRow density="compact">
          <WorkbenchListRowTrigger
            aria-label={`Open ${resume.title}`}
            disabled={disabled}
            onClick={onOpen}
          >
            <WorkbenchListRowLeading>
              <FileText className="size-4" />
            </WorkbenchListRowLeading>
            <WorkbenchListRowText
              title={resume.title}
              description={resume.targetRole || undefined}
            />
          </WorkbenchListRowTrigger>
          <WorkbenchListRowMeta className="hidden tabular-nums @sm:inline">
            <time
              dateTime={resume.updatedAt}
              aria-label={`Last edited ${new Date(resume.updatedAt).toLocaleDateString()}`}
            >
              {new Date(resume.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>
          </WorkbenchListRowMeta>
          <WorkbenchListRowActions aria-label={`Actions for ${resume.title}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={`Actions for ${resume.title}`}
                  tooltip="Resume actions"
                  size="sm"
                  disabled={disabled}
                >
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <MenuEntries entries={entries} family="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </WorkbenchListRowActions>
        </WorkbenchListRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={entries} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
