import type { ReactNode } from 'react'
import { SectionLabel } from '@localixai/kit/section-label'
import type { PluginRecord, PluginUpdatesResponse } from '@/shared/api/contracts'
import { SettingRegistryList } from '../settingRegistry'
import type { PluginRowUpdate } from './PluginRow'

/**
 * The plugin list in its groups: the plugins built into Localix first, as Claude Code lists
 * `@builtin` ones apart, then the installed ones. With no built-in plugin it is one plain list.
 * Each row is handed the update its marketplace offers, matched by name from
 * `GET /rpc/plugins/updates` (a built-in plugin is never offered one).
 */
export function PluginGroups({
  plugins,
  updates,
  renderRow,
}: {
  plugins: PluginRecord[]
  updates: PluginUpdatesResponse | undefined
  renderRow: (plugin: PluginRecord, update: PluginRowUpdate | undefined) => ReactNode
}) {
  const offered = new Map(
    (updates?.available ?? []).map((entry) => [
      entry.name,
      { id: entry.id, from: entry.from, to: entry.to },
    ]),
  )
  const row = (plugin: PluginRecord) =>
    renderRow(plugin, plugin.builtin ? undefined : offered.get(plugin.name))
  const builtin = plugins.filter((plugin) => plugin.builtin)
  const installed = plugins.filter((plugin) => !plugin.builtin)
  if (builtin.length === 0) return <SettingRegistryList>{installed.map(row)}</SettingRegistryList>
  return (
    <div className="space-y-4">
      <PluginGroup title="Built-in">{builtin.map(row)}</PluginGroup>
      {installed.length > 0 && <PluginGroup title="Installed">{installed.map(row)}</PluginGroup>}
    </div>
  )
}

function PluginGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2">
        <SectionLabel as="span" weight="semibold">
          {title}
        </SectionLabel>
      </h3>
      <SettingRegistryList>{children}</SettingRegistryList>
    </section>
  )
}
