/**
 * WHICH VERSION OF THE PLAN THIS TAB SHOWS — a quiet readout in the header, a menu when there is
 * a choice.
 *
 * It was the kit's form `Select`: a framed, filled field that, sitting alone at the end of the
 * header, out-shouted the plan it belongs to. Choosing a version is secondary navigation, so it
 * takes the app's quiet header trigger (text and a chevron, the shared veils on hover and open —
 * the reasoning level's shape) and the shared menu, with each version's status as the line under
 * its name rather than glued into the label. With a single version and no file there is nothing to
 * choose, and the readout is plain text.
 *
 * The version's FILE lives here too. Every version is a snapshot file (`v<N>.md`) the person may
 * want to open in the editor or hand to another tool; a path spelled out in the header would
 * out-shout the title, so the menu that already names the version carries "Open" and "Copy path".
 */
import { ChevronDown, Copy, FileText } from 'lucide-react'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import type { SessionPlan } from '@localixai/api/client'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

export const PLAN_STATUS_LABEL: Record<SessionPlan['status'], string> = {
  presented: 'waiting for you',
  approved: 'approved',
  completed: 'completed',
  superseded: 'superseded',
  dismissed: 'dismissed',
}

const readout = (plan: SessionPlan) => `v${plan.version} · ${PLAN_STATUS_LABEL[plan.status]}`

/** The file's own name, for the row that opens it: the full path is in "Copy path". */
const baseName = (path: string) => path.split(/[\\/]/).pop() || path

export function PlanVersionMenu({
  plans,
  current,
  onPick,
  onOpenFile,
}: {
  /** Every version, newest first. */
  plans: readonly SessionPlan[]
  current: SessionPlan
  onPick: (planId: string) => void
  /** Open the version's snapshot file; absent when there is nowhere to open it. */
  onOpenFile?: (path: string) => void
}) {
  const filePath = current.filePath || undefined
  if (plans.length < 2 && !filePath) {
    return <span className="shrink-0 px-1.5 text-2xs text-text-faint">{readout(current)}</span>
  }
  const versions: MenuEntry[] =
    plans.length < 2
      ? []
      : plans.map((plan) => ({
          id: plan.id,
          label: `Version ${plan.version}`,
          description: PLAN_STATUS_LABEL[plan.status],
          selected: plan.id === current.id,
          onSelect: () => {
            if (plan.id !== current.id) onPick(plan.id)
          },
        }))
  const file: MenuEntry[] = filePath
    ? [
        ...(onOpenFile
          ? [
              {
                id: 'open-file',
                label: `Open ${baseName(filePath)}`,
                icon: FileText,
                onSelect: () => onOpenFile(filePath),
              },
            ]
          : []),
        {
          id: 'copy-path',
          label: 'Copy path',
          icon: Copy,
          onSelect: () => void copyText(filePath, 'Path'),
        },
      ]
    : []
  const entries: MenuEntry[] = [...versions, { separator: true }, ...file]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Plan version: ${readout(current)}. Change`}
          className="inline-flex h-(--chrome-control-sm) shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-text-soft focus-ring aria-expanded:bg-surface-active aria-expanded:text-text-soft"
        >
          <span>{readout(current)}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
