import { useId } from 'react'
import { Check, Users } from 'lucide-react'
import { cn, CONTROL_FOCUS_WITHIN } from '@localixai/mini-app-sdk/ui/classes'
import { SELECTED_ROW } from '@localixai/kit/selected-row'

/**
 * The "All agents" row at the top of the picker's Agents group (`partyRoute.ts`).
 *
 * Drawn on the same row recipe as each participant — selecting it points the model list and the
 * reasoning menu at the whole room, so the existing controls do the choosing and nothing new is
 * invented for it. Its second line says what the room runs on now ("Mixed · 2 models · 1 not
 * set"), and the button names that state too, so a screen reader hears why the row is offered.
 * A check marks "All" when every listed agent is on one model and level; a pick for one agent
 * alone clears it.
 */
export function PartyRouteRow({
  active,
  status,
  mixed,
  chosen,
  onSelect,
}: {
  active: boolean
  status: string
  /** The agents disagree or one has no model: the status is tinted as a warning. */
  mixed: boolean
  /** Every listed agent is on one model and level (`isAllChosen`). */
  chosen: boolean
  onSelect: () => void
}) {
  const statusId = useId()
  return (
    <div
      title="Apply one model and reasoning level to every agent, and to agents invited later"
      data-testid="party-route-row"
      className={cn(
        'relative isolate flex w-full select-none flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left transition-colors duration-(--dur-fast)',
        CONTROL_FOCUS_WITHIN,
        active ? cn(SELECTED_ROW, 'shadow-none') : 'hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        aria-label="Configure all agents"
        aria-describedby={statusId}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none"
      />
      <span className="pointer-events-none relative z-(--z-raised) flex min-h-(--chrome-control-xs) w-full min-w-0 items-center gap-1.5">
        <Users aria-hidden className="size-3.5 shrink-0 text-text-soft" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          All agents
        </span>
        {chosen && (
          <Check
            aria-label="All agents share this model"
            data-testid="party-route-chosen"
            className="size-3.5 shrink-0 text-text-soft"
          />
        )}
      </span>
      <span
        id={statusId}
        className={cn(
          'pointer-events-none relative z-(--z-raised) w-full truncate text-2xs',
          mixed ? 'text-status-warning' : 'text-text-soft',
        )}
      >
        {status}
      </span>
    </div>
  )
}
