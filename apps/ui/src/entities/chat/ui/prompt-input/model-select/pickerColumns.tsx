import type { ComponentProps } from 'react'
import type { ProviderEntry } from '@localixai/agent/catalog'
import { CompactPickerNav } from './CompactPickerNav'
import { ModelSelectSidebar, type SelectedItem } from './ModelSelectSidebar'
import { ModelTaskColumn } from './ModelTaskColumn'
import type { PickerColumnLayout } from './pickerRow'

type TaskColumnProps = Omit<ComponentProps<typeof ModelTaskColumn>, 'layout'>
type ProviderColumnProps = Omit<ComponentProps<typeof ModelSelectSidebar>, 'layout'>

interface PickerColumnsInput {
  /** Show the workload column at all (off in the agent editor, which routes nothing). */
  taskColumn: boolean
  task: TaskColumnProps
  provider: ProviderColumnProps
  /** What the workload switcher names: the active agent or workload. */
  workloadLabel: string
  allProviders: readonly ProviderEntry[]
}

/** What the provider switcher names for each kind of selection. */
function providerLabel(
  selectedItem: SelectedItem,
  connectionLabel: string | undefined,
  allProviders: readonly ProviderEntry[],
): string {
  switch (selectedItem?.type) {
    case 'favorite':
      return 'Favorites'
    case 'recent':
      return 'Recent'
    case 'connection':
      return connectionLabel ?? 'Provider'
    case 'provider':
      return allProviders.find((p) => p.id === selectedItem.id)?.name ?? 'Provider'
    case undefined:
      return 'Choose a provider'
  }
}

/**
 * The picker's two side columns, built once and drawn twice: as columns from md up, and as the
 * sheets the narrow layout's header switchers open (`CompactPickerNav`).
 *
 * One builder for both places is the point. Two call sites spelling the same props would drift
 * the way the picker's columns had drifted, and a sheet that selected differently from its
 * column would be a second picker. A sheet's selection also closes it; a column ignores `close`.
 */
export function pickerColumns({
  taskColumn,
  task,
  provider,
  workloadLabel,
  allProviders,
}: PickerColumnsInput) {
  const taskColumnFor = (layout: PickerColumnLayout, close?: () => void) => (
    <ModelTaskColumn
      {...task}
      layout={layout}
      onSelectTask={(key) => {
        task.onSelectTask(key)
        close?.()
      }}
    />
  )
  const providerColumnFor = (layout: PickerColumnLayout, close?: () => void) => (
    <ModelSelectSidebar
      {...provider}
      layout={layout}
      setSelectedItem={(item) => {
        provider.setSelectedItem(item)
        close?.()
      }}
    />
  )
  const nav = (
    <CompactPickerNav
      workload={
        taskColumn
          ? {
              label: workloadLabel,
              ariaLabel: 'Workload',
              render: (close) => taskColumnFor('sheet', close),
            }
          : undefined
      }
      provider={{
        label: providerLabel(provider.selectedItem, provider.selectedConn?.label, allProviders),
        ariaLabel: 'Provider',
        render: (close) => providerColumnFor('sheet', close),
      }}
    />
  )
  return { taskColumnFor, providerColumnFor, nav }
}
