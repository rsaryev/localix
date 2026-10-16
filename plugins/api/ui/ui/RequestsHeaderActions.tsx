import { ArrowDownUp, FilePlus2, FolderPlus, Plus } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { useEnvironments } from '../model/useEnvironments'
import { sortGroupEntries } from '../model/sidebarModes'
import type { GroupMode, SortMode } from '../model/sortRequests'
import { EnvironmentPicker } from './EnvironmentPicker'

/** The Requests header actions: environment, new/import, sort and group, refresh. */
export function RequestsHeaderActions({
  environments: { environments, active, use },
  onManageEnvironments,
  createNew,
  setFolderParent,
  setImportOpen,
  sort,
  setSort,
  group,
  setGroup,
  refresh,
}: {
  environments: ReturnType<typeof useEnvironments>
  onManageEnvironments: () => void
  createNew: () => void
  setFolderParent: (parent: string) => void
  setImportOpen: (open: boolean) => void
  sort: SortMode
  setSort: (v: SortMode) => void
  group: GroupMode
  setGroup: (v: GroupMode) => void
  refresh: () => Promise<unknown>
}) {
  return (
    <>
      <EnvironmentPicker
        environments={environments}
        active={active}
        onUse={(name) => void use(name)}
        onManage={onManageEnvironments}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label="New request">
            <Plus className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => createNew()}>
            <FilePlus2 className="size-3.5" />
            New request
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFolderParent('')}>
            <FolderPlus className="size-3.5" />
            New folder…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setImportOpen(true)}>Import…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label="Sort and group">
            <ArrowDownUp className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <MenuEntries
            entries={sortGroupEntries(sort, setSort, group, setGroup)}
            family="dropdown"
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <RefreshAction
        size="sm"
        aria-label="Refresh"
        tooltip="Refresh"
        onClick={() => void refresh()}
      />
    </>
  )
}
