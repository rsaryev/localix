import type { ComponentProps } from 'react'
import { FolderPlus, Plus, Search } from 'lucide-react'
import { PanelHeader } from '@localixai/kit/panel-header'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import type { DataSource } from '@/shared/ui/DataSourceTabs'
import { ChatSidebarViewMenu } from './ChatSidebarViewMenu'
import { ScopeSwitcher } from './ScopeSwitcher'

export function ChatSidebarHeader({
  source,
  scopeName,
  isGlobal,
  onOpenScopeSwitcher,
  onAddProjectFolder,
  onNewChat,
  viewMenu,
  searchVisible,
  onToggleSearch,
}: {
  source: DataSource
  scopeName: string | null
  isGlobal: boolean
  onOpenScopeSwitcher: () => void
  onAddProjectFolder: () => void
  onNewChat: () => void
  viewMenu: ComponentProps<typeof ChatSidebarViewMenu>
  searchVisible: boolean
  onToggleSearch: () => void
}) {
  const local = source === 'localix'
  const searchLabel = searchVisible
    ? 'Hide search'
    : local
      ? 'Search chats'
      : 'Search external sessions'
  return (
    <PanelHeader
      title={<ScopeSwitcher scopeName={scopeName} onOpen={onOpenScopeSwitcher} />}
      actions={
        <>
          {local && <ChatSidebarViewMenu {...viewMenu} />}
          <IconButton
            size="sm"
            surface="sidebar"
            onClick={onToggleSearch}
            aria-label={searchLabel}
            tooltip={searchLabel}
            aria-pressed={searchVisible}
          >
            <Search className="size-3.5" />
          </IconButton>
          {local && isGlobal && (
            <IconButton
              size="sm"
              surface="sidebar"
              onClick={onAddProjectFolder}
              aria-label="Add project folder"
              tooltip="Add project folder"
            >
              <FolderPlus className="size-3.5" />
            </IconButton>
          )}
          {local && (
            <IconButton
              size="sm"
              surface="sidebar"
              onClick={onNewChat}
              aria-label={scopeName ? `New chat in ${scopeName}` : 'New chat'}
              tooltip={scopeName ? `New chat in ${scopeName}` : 'New chat'}
            >
              <Plus className="size-3.5" />
            </IconButton>
          )}
        </>
      }
    />
  )
}

export function HistorySearchField({
  source,
  visible,
  value,
  onChange,
  onClose,
}: {
  source: DataSource
  visible: boolean
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  if (!visible) return null
  return (
    <div className="shrink-0 px-2 pt-2">
      <SearchInput
        tone="sidebar"
        inset
        value={value}
        onValueChange={onChange}
        autoFocus
        placeholder={
          source === 'localix' ? 'Filter chats in this workspace…' : 'Find an external session…'
        }
        className="w-full"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      />
    </div>
  )
}
