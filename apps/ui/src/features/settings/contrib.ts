import { Puzzle, Settings, SlidersHorizontal, Wrench } from 'lucide-react'
import type { PluginUiHost, UiAnchorNode } from '@localixai/plugin-sdk/ui'
import { SETTINGS_INDEX } from './model/settingsIndex'
import {
  settingsTargetUri,
  parseSettingsAnchorUri,
  pluginSettingsUri,
} from '@/shared/lib/settingsAnchors'
import { SETTINGS_STRING_TABS } from '@/shared/routing/routes'
import { pluginContribSnapshot } from '@/shared/contrib/enabledPlugins'
import { listUiLocations } from '@/shared/contrib/uiLocations'
import { pluginLabel } from '@localixai/plugin-sdk/manifest'

function settingsChildren(parentUri: string | null): UiAnchorNode[] {
  if (parentUri === null) {
    return [
      {
        uri: settingsTargetUri(),
        label: 'Settings',
        detail: 'Preferences, capabilities, and diagnostics',
        hasChildren: true,
        icon: 'settings',
        group: 'Application',
      },
    ]
  }
  if (parentUri === settingsTargetUri()) {
    const byUri = new Map<string, ReturnType<typeof listUiLocations>[number]>()
    for (const location of listUiLocations({ exposure: 'search' })) {
      if (location.uri.startsWith('localix://ui/settings/')) byUri.set(location.uri, location)
    }
    return SETTINGS_STRING_TABS.flatMap((tab) => {
      const uri = settingsTargetUri({ tab })
      const location = byUri.get(uri)
      return location
        ? [
            {
              uri,
              label: location.title,
              detail: location.description,
              hasChildren: SETTINGS_INDEX.some((entry) => entry.tab === tab),
              icon: location.icon ?? 'settings-tab',
            },
          ]
        : []
    })
  }
  const parsed = parseSettingsAnchorUri(parentUri)
  if (!parsed || parentUri !== settingsTargetUri({ tab: parsed.tab })) return []
  const rows: UiAnchorNode[] = []
  for (const entry of SETTINGS_INDEX) {
    if (entry.tab !== parsed.tab) continue
    rows.push({
      uri: settingsTargetUri({ tab: entry.tab, anchor: entry.anchor, entryId: entry.id }),
      label: entry.title,
      detail: entry.description,
      hasChildren: false,
      icon: 'settings-section',
    })
  }
  if (parsed.tab === 'plugins') {
    for (const plugin of pluginContribSnapshot().plugins) {
      rows.push({
        uri: pluginSettingsUri(plugin.name, plugin.projectId),
        label: pluginLabel(plugin),
        detail: `${plugin.enabled ? 'Enabled' : 'Disabled'} · ${plugin.name}`,
        hasChildren: false,
        icon: 'plugin',
      })
    }
  }
  return rows
}

export function registerUi(host: PluginUiHost): void {
  host.anchors.register({
    id: 'settings',
    namespaces: ['settings'],
    icons: {
      settings: Settings,
      'settings-tab': SlidersHorizontal,
      'settings-section': Wrench,
      plugin: Puzzle,
    },
    listChildren: settingsChildren,
    resolve: (uri) => {
      const target = parseSettingsAnchorUri(uri)
      return target ? { kind: 'settings', ...target } : null
    },
  })
}
