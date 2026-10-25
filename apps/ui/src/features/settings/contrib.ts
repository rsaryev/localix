import { Settings, SlidersHorizontal, Wrench } from 'lucide-react'
import type { MiniAppUiHost, UiAnchorNode } from '@localixai/mini-app-sdk/ui'
import { SETTINGS_INDEX } from '@/shared/lib/settings-index/settingsIndex'
import { settingsTargetUri, parseSettingsAnchorUri } from '@/shared/lib/settingsAnchors'
import { SETTINGS_STRING_TABS } from '@/shared/routing/routes'
import { listUiLocations } from '@/shared/contrib/uiLocations'

function settingsChildren(parentUri: string | null): UiAnchorNode[] {
  if (parentUri === null) {
    return [
      {
        uri: settingsTargetUri(),
        label: 'Settings',
        detail: 'Preferences, permissions, models and diagnostics',
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
  return rows
}

export function registerUi(host: MiniAppUiHost): void {
  host.anchors.register({
    id: 'settings',
    namespaces: ['settings'],
    icons: {
      settings: Settings,
      'settings-tab': SlidersHorizontal,
      'settings-section': Wrench,
    },
    listChildren: settingsChildren,
    resolve: (uri) => {
      const target = parseSettingsAnchorUri(uri)
      return target ? { kind: 'settings', ...target } : null
    },
  })
}
