/**
 * "Approve ▾" — approving a plan is choosing HOW FREELY the work proceeds and, when there is
 * more than one agent, WHO starts it. A menu of two choices and the act.
 *
 * The defects it replaces, in the order they were met:
 *   - a header sentence, a mode control with a hint paragraph under it, and a free-text note
 *     whose `@mentions` decided who answered — a form for what is one or two picks, and a note
 *     that could name a handle the conversation did not know;
 *   - each choice behind its own dropdown opened from inside a popover, which landed detached
 *     below it;
 *   - a popover of a segmented mode row and a wrapped grid of agent chips: cramped, unlike every
 *     other menu in the app (the composer's mode menu lists the same three modes in another
 *     material), and the Autonomous segment lost its icon to the squeeze.
 *
 * So it IS the app's menu (`DropdownMenu` + `MenuEntries`, the composer mode menu's family): a
 * Mode row whose value is its `hint` and whose submenu lists the modes as that menu does — toned
 * icon, name, what it means, a check on the chosen one; an Agent row the same way, only when the
 * root conversation has two or more participants (a one-agent chat has nobody to choose between),
 * listing Any agent (no `to`: the conversation picks, as for a message with no @mention), each
 * participant as its coloured monogram (the author first) and Everyone; then Approve. A pick
 * keeps the menu open and steps back to the rows, so the person sees the answer before approving;
 * only Approve closes it, and only once the approval is recorded. The ordinary answers are
 * preselected — Default, Any agent — so Approve stays two clicks away.
 *
 * It opens ABOVE its trigger like every composer chip: the plan strip sits on the composer, and a
 * menu opening downward lands over the message being written (Radix flips it when there is no
 * room, as in the plan tab's header). ⌘/Ctrl+Enter approves; Escape closes.
 */
import { useMemo, useState } from 'react'
import { Check, ChevronDown, Shuffle, Users } from 'lucide-react'
import type { ImplementationMode } from '@localixai/api/client'
import { PERMISSION_MODE_COPY } from '@localixai/api/permission-modes'
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { monogramIcon } from '@localixai/kit/avatar'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

import { resolveHandleIdentity } from '@/shared/contrib/useAgentIdentity'
import { isPrimaryModifier } from '@/shared/lib/keybindings'
import { useMiniAppContribVersion } from '@/shared/contrib/useMiniAppContribVersion'
import {
  usePlanAddressees,
  type PlanAddressee,
  type PlanAuthorRef,
} from '../../model/planAddressees'
import { PERMISSION_MODE_MENU_ICON } from '../prompt-input/permissionModeIcons'

/**
 * WHICH DECISION ON A WAITING PLAN IS THE EXPECTED NEXT STEP — one answer for the strip, the plan
 * tab and the attention dialog, so the three cannot mark different buttons for the same version.
 * Open comments mean the person has something to tell the agent, so sending them is the step;
 * without any, approving is. Not for a decided version: there is nothing left to suggest. The run
 * is never busy here — presenting a plan ends the author's turn while it waits.
 */
export type PlanNextStep = 'approve' | 'request-changes' | null

export function planNextStep(presented: boolean, openComments: number): PlanNextStep {
  if (!presented) return null
  return openComments > 0 ? 'request-changes' : 'approve'
}

/** The order they are offered in, the careful one first and selected. */
const MODES: readonly ImplementationMode[] = ['default', 'bypass', 'autonomous']

/** How one addressee reads in the Agent submenu and, once chosen, as the Agent row's value. */
interface AddresseeRow {
  to: string | null
  label: string
  description?: string
  icon: IconComponent
}

function useAddresseeRows(addressees: readonly PlanAddressee[]): AddresseeRow[] {
  // A dependency, not a value: a capability publish can rename an agent.
  const version = useMiniAppContribVersion()
  return useMemo(
    () =>
      addressees.map((row): AddresseeRow => {
        if (row.kind === 'any')
          return {
            to: null,
            label: 'Any agent',
            description: 'The conversation picks who answers',
            icon: Shuffle,
          }
        if (row.kind === 'everyone')
          return {
            to: row.to,
            label: 'Everyone',
            description: 'Every participant, each in turn',
            icon: Users,
          }
        const { name } = resolveHandleIdentity(row.to!)
        return {
          to: row.to,
          label: name,
          description: row.author ? 'Wrote the plan' : undefined,
          icon: monogramIcon(row.to!, name),
        }
      }),
    [addressees, version],
  )
}

export function ApprovePlanPopover({
  ownerId,
  author,
  version,
  onApprove,
  disabled,
  busy,
  recommended = false,
  size = 'sm',
}: {
  /** The root conversation the plan belongs to — whose participants it can be handed to. */
  ownerId: string | null
  /** Who presented the version: listed first among the agents. */
  author: PlanAuthorRef
  version?: number
  /** Answers whether the approval was recorded; the menu closes only then. */
  onApprove: (mode: ImplementationMode, to?: string) => Promise<boolean>
  disabled?: boolean
  busy?: boolean
  /** Approving is the expected next step here (`planNextStep`); dropped while a decision runs. */
  recommended?: boolean
  size?: 'xs' | 'sm'
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ImplementationMode>('default')
  // `null` = Any agent: no `to`, the conversation's strategy picks who answers.
  const [picked, setPicked] = useState<string | null>(null)
  // Empty below two agents: a one-agent chat has nobody to choose between.
  const rows = useAddresseeRows(usePlanAddressees(ownerId, author))
  // An agent removed while the menu was open falls back to Any rather than a stale handle.
  const chosen = rows.find((row) => row.to === picked) ?? rows.find((row) => row.to === null)
  const to = chosen?.to ?? null

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    // Each opening starts from the ordinary answer: Default, and Any agent.
    if (!next) {
      setMode('default')
      setPicked(null)
    }
  }

  const submit = () => {
    if (busy) return
    void onApprove(mode, to ?? undefined).then((recorded) => {
      if (recorded) onOpenChange(false)
    })
  }

  const entries: MenuEntry[] = [
    { header: version ? `Approve plan v${version}` : 'Approve plan' },
    {
      id: 'mode',
      label: 'Mode',
      icon: PERMISSION_MODE_MENU_ICON[mode],
      hint: PERMISSION_MODE_COPY[mode].label,
      items: MODES.map((option) => ({
        id: `mode:${option}`,
        label: PERMISSION_MODE_COPY[option].label,
        description: PERMISSION_MODE_COPY[option].hint,
        icon: PERMISSION_MODE_MENU_ICON[option],
        selected: option === mode,
        keepOpen: true,
        onSelect: () => setMode(option),
      })),
    },
    ...(chosen
      ? [
          {
            id: 'agent',
            label: 'Agent',
            icon: chosen.icon,
            hint: chosen.label,
            items: rows.map((row) => ({
              id: `agent:${row.to ?? 'any'}`,
              label: row.label,
              description: row.description,
              icon: row.icon,
              selected: row.to === to,
              keepOpen: true,
              onSelect: () => setPicked(row.to),
            })),
          },
        ]
      : []),
    { separator: true },
    {
      id: 'approve',
      label: busy ? 'Approving…' : 'Approve',
      icon: Check,
      disabled: busy,
      // The same mark as the trigger, under the same rule (`planNextStep`): the menu it opens
      // onto would otherwise lose the cue exactly where the act has to be found.
      recommended: recommended && !busy,
      // Stays open until the approval is recorded, so a refused one keeps the picks.
      keepOpen: true,
      onSelect: submit,
    },
  ]

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled || busy}>
        <Button
          variant="mono"
          size={size}
          aria-label="Approve plan"
          recommended={recommended && !busy && !disabled}
        >
          <Check data-icon="inline-start" aria-hidden />
          {busy ? 'Approving…' : 'Approve'}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-64"
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter approves, as it sends in the composer.
          if (event.key === 'Enter' && isPrimaryModifier(event)) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
