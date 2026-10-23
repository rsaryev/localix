import type { ReactNode } from 'react'
import { CheckCircle2, CircleAlert, HelpCircle, Info, Search, TriangleAlert } from 'lucide-react'
import { tonedIcon } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type {
  EventCategoryFilter,
  EventFilters,
  EventSeverityFilter,
  EventTimeFilter,
} from '@/shared/lib/notifications/eventCenter'
import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import { IconButton } from '@localixai/kit/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@localixai/kit/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { FilterMenu, type FilterFacet, type FilterOption } from '../FilterMenu'
import { CATEGORY_ICON, CATEGORY_LABEL, SEVERITY_LABEL } from './eventPresentation'

/** What the person narrows the journal by; the session the route shows is added by the centre. */
export type JournalFilters = Omit<EventFilters, 'currentSessionId'>

export const DEFAULT_JOURNAL_FILTERS: JournalFilters = {
  scope: 'all',
  category: 'all',
  severity: 'all',
  time: 'all',
  query: '',
}

const CATEGORY_OPTIONS: readonly FilterOption<EventCategoryFilter>[] = [
  { value: 'all', label: 'All types' },
  ...(['human-input', 'agent', 'terminal', 'system'] as const).map((category) => ({
    value: category,
    label: CATEGORY_LABEL[category],
    icon: CATEGORY_ICON[category],
  })),
]

// Toned the way the rows draw the same severities, so a level reads the same in the menu.
const SEVERITY_OPTIONS: readonly FilterOption<EventSeverityFilter>[] = [
  { value: 'all', label: 'All levels' },
  {
    value: 'error',
    label: `${SEVERITY_LABEL.error}s`,
    icon: tonedIcon(CircleAlert, 'error'),
  },
  {
    value: 'warning',
    label: `${SEVERITY_LABEL.warning}s`,
    icon: tonedIcon(TriangleAlert, 'warning'),
  },
  { value: 'success', label: SEVERITY_LABEL.success, icon: tonedIcon(CheckCircle2, 'success') },
  { value: 'info', label: SEVERITY_LABEL.info, icon: tonedIcon(Info, 'info') },
]

const TIME_OPTIONS: readonly FilterOption<EventTimeFilter>[] = [
  { value: 'all', label: 'Any time' },
  { value: 'hour', label: 'Past hour' },
  { value: 'day', label: 'Past 24 hours' },
  { value: 'week', label: 'Past 7 days' },
]

/** One journal dimension as a filter-menu facet; every one of them narrows nothing at `all`. */
function facet<V extends string>(
  id: string,
  label: string,
  value: V,
  options: readonly FilterOption<V>[],
  onChange: (value: V) => void,
): FilterFacet<V> {
  return { id, label, value, allValue: 'all' as V, options, onChange }
}

export function EventFilterBar({
  filters,
  onChange,
  actionCount,
  unread,
  currentSessionId,
  shown,
  total,
}: {
  filters: JournalFilters
  onChange: (next: Partial<JournalFilters>) => void
  actionCount: number
  unread: number
  currentSessionId: string | null
  shown: number
  total: number
}) {
  const scope = filters.scope
  return (
    <>
      <div className="mt-2.5 flex items-center gap-1" role="group" aria-label="Event status">
        <ScopeButton active={scope === 'all'} onClick={() => onChange({ scope: 'all' })}>
          All
        </ScopeButton>
        <ScopeButton active={scope === 'action'} onClick={() => onChange({ scope: 'action' })}>
          Needs action {actionCount > 0 && <Count value={actionCount} />}
        </ScopeButton>
        <ScopeButton active={scope === 'unread'} onClick={() => onChange({ scope: 'unread' })}>
          Unread {unread > 0 && <Count value={unread} />}
        </ScopeButton>
        {currentSessionId && (
          <ScopeButton active={scope === 'session'} onClick={() => onChange({ scope: 'session' })}>
            This session
          </ScopeButton>
        )}
        {/* Only a narrowed list needs a count of its own; the header already states the total. */}
        {shown !== total && (
          <span className="ml-auto text-2xs tabular-nums text-text-faint">
            {shown} of {total}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <InputGroup className="min-w-48 flex-[1_1_18rem]">
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5 text-text-faint" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search events"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
            onKeyDown={(event) => {
              // Escape clears a query before it closes the popover, the way every search field does.
              if (event.key === 'Escape' && filters.query) {
                event.preventDefault()
                event.stopPropagation()
                onChange({ query: '' })
              }
            }}
            placeholder="Search or filter events…"
          />
          <InputGroupAddon align="inline-end" focusOnClick={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton aria-label="Search syntax" size="sm">
                  <HelpCircle className="size-3.5" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-80 leading-relaxed">
                Use level:error, type:terminal, session:LOCALIX-18, project:my-project,
                resource:tool, phase:failed, action:retry, has:trace, is:unread, is:resolved or
                is:repeated. Prefix any filter with − to exclude it.
              </TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        {/* Three framed selects sat here, crowding a popover: the narrowings are one menu. */}
        <FilterMenu
          label="Filter events"
          className="shrink-0"
          facets={[
            facet('category', 'Type', filters.category, CATEGORY_OPTIONS, (category) =>
              onChange({ category }),
            ),
            facet('severity', 'Severity', filters.severity, SEVERITY_OPTIONS, (severity) =>
              onChange({ severity }),
            ),
            facet('time', 'Time', filters.time, TIME_OPTIONS, (time) => onChange({ time })),
          ]}
        />
      </div>
    </>
  )
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'gap-1 text-2xs',
        active
          ? 'bg-surface-active text-foreground'
          : 'text-text-faint hover:bg-surface-hover hover:text-text-soft',
      )}
    >
      {children}
    </Button>
  )
}

function Count({ value }: { value: number }) {
  return (
    <Chip tone="accent" size="counter">
      {value > 99 ? '99+' : value}
    </Chip>
  )
}
