/** The object browser header keeps one compact overflow menu. Connection-level actions
 * live in the connection header, so this row only owns schema refresh/export. */
import { Download, MoreHorizontal, RefreshCw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'

export function SidebarHeader({
  label = 'Objects',
  totalTables,
  dumping,
  onExport,
  loading,
  onReload,
}: {
  label?: string
  totalTables: number
  dumping: boolean
  onExport: () => void
  loading: boolean
  onReload: () => void
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-1 px-2">
      <span className="truncate text-2xs font-medium uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="xs"
            aria-label="Object browser actions"
            tooltip="Object browser actions"
            disabled={loading || dumping}
          >
            {loading || dumping ? (
              <Spinner className="size-3" />
            ) : (
              <MoreHorizontal className="size-3.5" />
            )}
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={onReload}>
            <RefreshCw className="size-3.5" />
            Reload schema
          </DropdownMenuItem>
          {totalTables > 0 && (
            <DropdownMenuItem onSelect={onExport} disabled={dumping}>
              <Download className="size-3.5" />
              Export schema…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
