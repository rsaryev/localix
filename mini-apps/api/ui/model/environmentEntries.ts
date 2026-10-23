import { Ban, Layers } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { statusMenuList } from '@localixai/mini-app-sdk/ui'

import type { EnvironmentInfo } from '../../backend/contracts'

/**
 * The environment choice as menu rows — ONE list for the sidebar picker and the titlebar item.
 *
 * The two used to be built apart and had drifted: the sidebar folded the variable count into the
 * row's name (`staging · 3 vars`, read as part of what the environment is called), the titlebar
 * drew the same choice as `checked` checkboxes, and only one of them offered "no environment" as
 * a choice rather than a trailing command. A choice among siblings is a radio (`selected`): its
 * glyph stays in front, the active one is ticked at the end, and the count is a `hint` that lines
 * up in its own column.
 *
 * "No environment" is a row of the same list, because a request sent with nothing interpolated is
 * a real choice the backend models (an empty name), not an error state to clear by hand.
 */
export function environmentEntries({
  environments,
  onUse,
  header,
  onOverflow,
}: {
  environments: readonly EnvironmentInfo[]
  /** An empty name deactivates — see `useEnvironments.use`. */
  onUse: (name: string) => void
  header: string
  /** Where the full set lives once the list is truncated; absent → every row is listed. */
  onOverflow?: () => void
}): MenuEntry[] {
  const anyActive = environments.some((environment) => environment.active)
  return [
    { header },
    {
      id: 'env:none',
      label: 'No environment',
      icon: Ban,
      description: 'Requests use their literal URLs',
      selected: !anyActive,
      onSelect: () => onUse(''),
    },
    ...statusMenuList({
      items: environments,
      row: (environment) => ({
        id: `env:${environment.name}`,
        label: environment.name,
        icon: Layers,
        hint: varCount(environment.variables.length),
        selected: environment.active,
        onSelect: () => onUse(environment.name),
      }),
      ...(onOverflow
        ? { onOverflow, overflowLabel: (hidden: number) => `${hidden} more environments…` }
        : {}),
    }),
  ]
}

function varCount(count: number): string {
  return `${count} ${count === 1 ? 'var' : 'vars'}`
}
