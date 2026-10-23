/**
 * The active-environment menu — the sidebar's answer to "where do these requests actually go?".
 *
 * A request written as `{{base_url}}/users` is portable precisely because its destination is NOT in
 * the request, which means the destination needs a stable, nearby control. A picker tucked in a
 * settings page would make "which deployment am I hitting" a question you have to go and ask.
 *
 * It shares the Requests header instead of owning a permanent row: environment choice is always one
 * click away, but it no longer pushes every request down or repeats a sentence on every visit.
 * The menu's Manage action asks the parent workspace to replace the request editor with the inline
 * environment surface, avoiding a second window layered over the workbench.
 *
 * The rows are `environmentEntries()` — the same list the titlebar item shows — rendered through
 * the kit's `MenuEntries`, so the two places that switch an environment cannot drift apart again.
 */

import { Layers, Settings2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EnvironmentInfo } from '../../backend/contracts'
import { environmentEntries } from '../model/environmentEntries'

export function EnvironmentPicker({
  environments,
  active,
  onUse,
  onManage,
  className,
}: {
  environments: EnvironmentInfo[]
  active: EnvironmentInfo | null
  /** An empty name deactivates — see `useEnvironments.use`. */
  onUse: (name: string) => void
  onManage?: () => void
  className?: string
}) {
  const label = active ? `Environment: ${active.name}` : 'Environment: none'

  const entries: MenuEntry[] = [
    ...environmentEntries({ environments, onUse, header: 'Active environment' }),
    ...(environments.length === 0
      ? [{ id: 'env:empty', label: 'No environments created yet', disabled: true, onSelect() {} }]
      : []),
    ...(onManage
      ? ([
          { separator: true },
          { id: 'manage', label: 'Manage environments…', icon: Settings2, onSelect: onManage },
        ] satisfies MenuEntry[])
      : []),
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          aria-label={label}
          tooltip={label}
          className={cn(active && 'text-status-info', className)}
        >
          <Layers className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
