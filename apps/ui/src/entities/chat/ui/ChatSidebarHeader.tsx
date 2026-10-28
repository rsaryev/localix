import type { ComponentProps } from 'react'
import { FolderPlus, Search } from 'lucide-react'
import { PanelHeader } from '@localixai/kit/panel-header'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import { ChatSidebarViewMenu } from './ChatSidebarViewMenu'
import { ScopeSwitcher } from './ScopeSwitcher'

export function ChatSidebarHeader({
  scopeName,
  isGlobal,
  onOpenScopeSwitcher,
  onAddProjectFolder,
  viewMenu,
  searchVisible,
  onToggleSearch,
}: {
  scopeName: string | null
  isGlobal: boolean
  onOpenScopeSwitcher: () => void
  onAddProjectFolder: () => void
  viewMenu: ComponentProps<typeof ChatSidebarViewMenu>
  searchVisible: boolean
  onToggleSearch: () => void
}) {
  const searchLabel = searchVisible ? 'Hide search' : 'Search chats'
  return (
    <PanelHeader
      title={<ScopeSwitcher scopeName={scopeName} onOpen={onOpenScopeSwitcher} />}
      actions={
        <>
          <ChatSidebarViewMenu {...viewMenu} />
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
          {isGlobal && (
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
        </>
      }
    />
  )
}

export function HistorySearchField({
  visible,
  value,
  onChange,
  onClose,
}: {
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
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- SearchInput focuses by hand once; the field only appears after the person opens search
        autoFocus
        placeholder="Filter chats in this workspace…"
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
