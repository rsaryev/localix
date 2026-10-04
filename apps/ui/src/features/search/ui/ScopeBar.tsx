import { cn } from '@localixai/plugin-sdk/ui/classes'
import { SELECTED_ROW } from '@localixai/kit/selected-row'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { ALL_SCOPE, allScopes, type ScopeDef } from '../model/scopes'
import { searchIconEl } from './searchIcons'

/**
 * The scope selector — a horizontally-scrollable row of "filter atom" pills.
 * The active pill is highlighted; picking one narrows the query. `all`
 * clears the filter. Typing a `prefix:` in the input promotes into the same pills.
 * Each pill is the shared TogglePill with the bar's borderless-transparent inactive
 * look layered over it (className merges last, so the overrides win per state).
 */
export function ScopeBar({
  scope,
  onPick,
}: {
  scope: ScopeDef
  onPick: (id: string | null) => void
}) {
  const pills = [ALL_SCOPE, ...allScopes()]
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
      {pills.map((s) => {
        const active = scope.id === s.id
        return (
          <TogglePill
            key={s.id}
            active={active}
            onClick={() => onPick(s.id === ALL_SCOPE.id ? null : s.id)}
            title={s.placeholder ?? s.label}
            className={cn(
              'shrink-0 gap-1 rounded-full px-2 py-0.5',
              !active &&
                'border-border-soft bg-transparent hover:border-border-soft hover:bg-surface-hover',
            )}
            activeClassName={cn('border-transparent', SELECTED_ROW)}
          >
            {searchIconEl(s.icon, 'size-3')}
            {s.label}
          </TogglePill>
        )
      })}
    </div>
  )
}
