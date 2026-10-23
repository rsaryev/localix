import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { groupOf } from '../model/storeFilters'
import { MiniAppStoreRow, type MiniAppStoreRowProps } from './MiniAppStoreRow'

const GROUPS = [
  { id: 'updates', title: 'Updates' },
  { id: 'installed', title: 'Installed' },
  { id: 'available', title: 'Available' },
] as const

type RowProps = Omit<MiniAppStoreRowProps, 'entry' | 'onInstallWithDesktop' | 'desktopProblem'> & {
  withDesktop: (entry: MiniAppStoreEntryRecord) => MiniAppStoreRowProps['onInstallWithDesktop']
  desktopProblems: Record<string, string>
}

function Group({
  title,
  label,
  rows,
  withDesktop,
  desktopProblems,
  ...props
}: { title: string; label?: string; rows: MiniAppStoreEntryRecord[] } & RowProps) {
  if (rows.length === 0) return null
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-medium text-text-soft">
        {title} <span className="text-text-faint tabular-nums">{rows.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-x-4 @3xl:grid-cols-2">
        {rows.map((entry) => (
          <MiniAppStoreRow
            key={entry.name}
            entry={entry}
            onInstallWithDesktop={withDesktop(entry)}
            desktopProblem={desktopProblems[entry.name]}
            {...props}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * The apps that pass the store's filters: the ones the Localix catalog features first, then
 * Updates, Installed and Available, one row each.
 */
export function MiniAppStoreList({
  shown,
  ...props
}: { shown: MiniAppStoreEntryRecord[] } & RowProps) {
  if (shown.length === 0) return <EmptyHint>Nothing matches.</EmptyHint>
  const featured = shown.filter((entry) => entry.featured && !entry.installed)
  return (
    <>
      <Group title="Featured" label="Featured" rows={featured} {...props} />
      {GROUPS.map(({ id, title }) => (
        <Group
          key={id}
          title={title}
          rows={shown.filter((entry) => groupOf(entry) === id)}
          {...props}
        />
      ))}
    </>
  )
}
