import { TabBar, type useTabPanelIds } from '@localixai/kit/tabs'

export type DataSource = 'localix' | 'external'

/** History and statistics use the same quiet, keyboard-accessible source switch. */
export function DataSourceTabs({
  value,
  onChange,
  ids,
  label,
}: {
  value: DataSource
  onChange: (source: DataSource) => void
  ids: ReturnType<typeof useTabPanelIds>
  label: string
}) {
  return (
    <TabBar
      aria-label={label}
      stretch
      active={value}
      onChange={onChange}
      items={[
        { id: 'localix', label: 'Localix', ...ids.item('localix') },
        { id: 'external', label: 'External', ...ids.item('external') },
      ]}
    />
  )
}
